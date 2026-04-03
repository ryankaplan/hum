import { useCallback, useRef, useSyncExternalStore } from "react";

type Subscribable = {
  // Register a persistent callback that will be called on every change.
  register: (onChange: Function) => Function;

  // Register a callback that will be called on the next change and then
  // removed.
  once: (onChange: Function) => Function;
};

class SubscribableBase implements Subscribable {
  private _listeners: Function[] = [];
  private _onceListeners: Function[] = [];

  register = (onChange: Function) => {
    this._listeners.push(onChange);

    return () => {
      this._listeners = this._listeners.filter((x) => x !== onChange);
    };
  };

  once = (onChange: Function) => {
    this._onceListeners.push(onChange);
    return () => {
      this._onceListeners = this._onceListeners.filter((x) => x !== onChange);
    };
  };

  protected notifyListeners = () => {
    for (const listener of this._listeners) {
      listener();
    }

    for (const listener of this._onceListeners) {
      listener();
    }
    this._onceListeners = [];
  };
}

export interface ReadOnlyObservable<T> extends Subscribable {
  get(): T;
}

export class Observable<T>
  extends SubscribableBase
  implements ReadOnlyObservable<T>
{
  private _onBeforeChange: ((from: T, to: T) => void)[] = [];
  private _onAfterChange: ((from: T, to: T) => void)[] = [];

  constructor(
    private _value: T,
    private equals?: (a: T, b: T) => boolean,
  ) {
    super();
  }

  onBeforeChange(cb: (from: T, to: T) => void) {
    this._onBeforeChange.push(cb);
  }

  onAfterChange(cb: (from: T, to: T) => void) {
    this._onAfterChange.push(cb);
  }

  get = () => {
    return this._value;
  };

  setWithDeferredNotification = (value: T): (() => void) => {
    if (value === this._value) {
      return () => {};
    }

    if (this.equals != null && this.equals(this._value, value)) {
      return () => {};
    }

    const oldValue = this._value;
    const newValue = value;

    for (const cb of this._onBeforeChange) {
      cb(oldValue, newValue);
    }

    this._value = value;

    for (const cb of this._onAfterChange) {
      cb(oldValue, newValue);
    }

    return () => {
      this.notifyListeners();
    };
  };

  set = (value: T) => {
    this.setWithDeferredNotification(value)();
  };
}

type Migration<T> = {
  fromKey: string;
  migrate: (rawValue: unknown) => T | unknown;
};

type MigrationChain<T> = Migration<T>[];

const ACTIVE_PERSISTED_OBSERVABLE_KEYS = new Set<string>();
const BLACKLISTED_PERSISTED_OBSERVABLE_KEYS = new Set<string>();

type PersistedObservableOpts<T> = {
  migrations?: MigrationChain<T>;
  // Called on every value loaded from localStorage before it is set. Use this
  // to coerce or filter stale persisted data at the storage boundary, keeping
  // in-memory values clean without having to validate on every `.set()`.
  schema?: (raw: unknown) => T;
};

export class PersistedObservable<T> extends Observable<T> {
  constructor(key: string, initialValue: T, opts?: PersistedObservableOpts<T>) {
    super(initialValue);

    // Error if trying to use a blacklisted key
    if (BLACKLISTED_PERSISTED_OBSERVABLE_KEYS.has(key)) {
      throw new Error(
        `Cannot create PersistedObservable with blacklisted key: "${key}". ` +
          `This key should not be used for new PersistedObservables. ` +
          `Use a different key name.`,
      );
    }

    ACTIVE_PERSISTED_OBSERVABLE_KEYS.add(key);

    this.runMigrationsAndSetInitialValue(key, opts?.migrations, opts?.schema);

    this.register(() => {
      localStorage.setItem(key, JSON.stringify(this.get()));
    });
  }

  runMigrationsAndSetInitialValue(
    key: string,
    migrations: MigrationChain<T> | undefined,
    schema: ((raw: unknown) => T) | undefined,
  ) {
    const parse = (raw: unknown): T => (schema ? schema(raw) : (raw as T));

    const currentValue = localStorage.getItem(key);

    // If there are no migrations, set the value if we have one stored.
    if (!migrations) {
      if (currentValue !== null) {
        this.set(parse(JSON.parse(currentValue)));
      }
      return;
    }

    // If we got here, then there _are_ migrations. If we have a value stored for the latest
    // key, we don't need to run any migrations. But let's check if we have old keys and
    // warn if we do.
    if (currentValue !== null) {
      const foundOldKeys = migrations
        .map((migration) => migration.fromKey)
        .filter((oldKey) => localStorage.getItem(oldKey) !== null);
      if (foundOldKeys.length > 0) {
        console.warn(
          "Both old and new localStorage keys found for PersistedObservable. Using new key:",
          key,
          "Ignoring old keys:",
          foundOldKeys,
        );
      }

      this.set(parse(JSON.parse(currentValue)));
      return;
    }

    // If we got here then we have migrations and no current value. Check to see if any
    // of the migration keys have a value stored.
    let oldestDataIndex = -1;
    let oldestData: any = null;
    for (let i = 0; i < migrations.length; i++) {
      const migration = migrations[i]!;
      const oldValue = localStorage.getItem(migration.fromKey);
      if (oldValue !== null) {
        oldestDataIndex = i;
        oldestData = oldValue;
        break;
      }
    }

    // If we found old data, migrate it forward
    if (oldestDataIndex !== -1 && oldestData !== null) {
      let migratedValue = JSON.parse(oldestData);

      // Run all migrations from the oldest data forward
      for (let i = oldestDataIndex; i < migrations.length; i++) {
        migratedValue = migrations[i]!.migrate(migratedValue);
      }

      this.set(parse(migratedValue));

      // We haven't registered a listener yet, so we need to set the value manually.
      localStorage.setItem(key, JSON.stringify(this.get()));

      // Clean up all old keys
      for (const migration of migrations) {
        localStorage.removeItem(migration.fromKey);
      }
    }
  }
}

type DerivedOpts<T> = {
  // On each notify, check to see if the value has changed. Notify our
  // listeners only if it has. Notably, this calls compute on each change!
  // So this is appropriate when compute is cheap and listeners are not.
  checkForEqualityOnNotify: boolean;

  // Defaults to JSON.stringify(a) === JSON.stringify(b)
  equals?: (a: T | null, b: T | null) => boolean;
};

export class Derived<T> extends SubscribableBase {
  private _cachedValue: T | null = null;

  constructor(
    private compute: () => T,
    dependencies: Subscribable[],
    private opts: DerivedOpts<T> = { checkForEqualityOnNotify: false },
  ) {
    super();
    for (const dependency of dependencies) {
      dependency.register(this.invalidateAndNotify);
    }
  }

  private invalidateAndNotify = () => {
    if (this.opts.checkForEqualityOnNotify) {
      const newValue = this.compute();

      // Check for equality using the provided equals function, or JSON.stringify
      // if no equals function is provided.
      if (this.opts.equals) {
        if (this.opts.equals(newValue, this._cachedValue)) {
          return;
        }
      } else {
        if (JSON.stringify(newValue) === JSON.stringify(this._cachedValue)) {
          return;
        }
      }

      this._cachedValue = newValue;
    } else {
      // Aggressively clear the cached value and notify listeners.
      this._cachedValue = null;
    }

    this.notifyListeners();
  };

  get value() {
    return this.get();
  }

  get = () => {
    if (this._cachedValue === null) {
      this._cachedValue = this.compute();
    }
    return this._cachedValue;
  };
}

export function derivedValue<T>(
  compute: () => T,
  dependencies: Subscribable[],
  opts: DerivedOpts<T> = { checkForEqualityOnNotify: false },
): Derived<T> {
  return new Derived(compute, dependencies, opts);
}

export function useObservable<T>(obs: ReadOnlyObservable<T> | Derived<T>) {
  // useSyncExternalStore has kind of an annoying requirement: it's important
  // that if the value hasn't changed that it returns the same value as last
  // time.
  //
  // This doesn't work when we're observing a value in rust which gets newly
  // serialized / deserialized each time we call get(..)
  //
  // So we cache the last known value here and clear it when we get a notify.
  const lastSnapshot = useRef<T | null>(null);

  const wrappedRegister = useCallback(
    (cb: () => void) => {
      return obs.register(() => {
        lastSnapshot.current = null;
        cb();
      }) as () => void;
    },
    [obs],
  );

  const wrappedGet = useCallback(() => {
    if (!lastSnapshot.current) {
      lastSnapshot.current = obs.get();
    }
    return lastSnapshot.current!;
  }, [obs, lastSnapshot]);

  return useSyncExternalStore(wrappedRegister, wrappedGet);
}

// Same as above but for when the observable is nullable. The result is
// nullable so the above function is preferred when possible. This is
// typically used when you want to subscribe conditionally without the
// code complexity of adding a new React component (typically as a
// performance optimization).
export function useObservableOrNull<T>(
  obs: ReadOnlyObservable<T> | Derived<T> | null | undefined,
): T | null {
  const lastSnapshot = useRef<T | null>(null);

  // Clear lastSnapshot when obs changes
  const obsRef = useRef(obs);
  if (obsRef.current !== obs) {
    lastSnapshot.current = null;
    obsRef.current = obs;
  }

  const wrappedRegister = useCallback(
    (cb: () => void) => {
      if (!obs) {
        return () => {};
      }

      return obs.register(() => {
        lastSnapshot.current = null;
        cb();
      }) as () => void;
    },
    [obs],
  );

  const wrappedGet = useCallback(() => {
    if (!obs) {
      return null;
    }

    if (lastSnapshot.current === null) {
      lastSnapshot.current = obs.get();
    }
    return lastSnapshot.current;
  }, [obs]);

  return useSyncExternalStore(wrappedRegister, wrappedGet);
}

/**
 * Helper function to read an old PersistedObservable value from localStorage
 * without creating a PersistedObservable. Useful for migrations.
 */
export function getOldPersistedObservableValue(key: string): unknown | null {
  const stored = localStorage.getItem(key);
  if (stored === null) {
    return null;
  }
  try {
    return JSON.parse(stored);
  } catch (e) {
    console.error(`Failed to parse localStorage value for key "${key}"`, e);
    return null;
  }
}

export function blacklistObservableKey(key: string): void {
  if (ACTIVE_PERSISTED_OBSERVABLE_KEYS.has(key)) {
    throw new Error(
      `Cannot blacklist key "${key}" because there is an active PersistedObservable using it. ` +
        `Make sure to blacklist keys before creating PersistedObservables, or ensure the key is no longer in use.`,
    );
  }

  BLACKLISTED_PERSISTED_OBSERVABLE_KEYS.add(key);
}
