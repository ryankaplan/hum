import { ChakraProvider } from "@chakra-ui/react";
import { createRoot } from "react-dom/client";
import { useObservable } from "./observable";
import { model } from "./state/model";
import { system } from "./theme";
import { SetupScreen } from "./ui/SetupScreen";
import { RecordingWizard } from "./ui/RecordingWizard";
import { FinalReview } from "./ui/FinalReview";

function App() {
  const screen = useObservable(model.appScreen);

  if (screen === "setup") return <SetupScreen />;
  if (screen === "recording") return <RecordingWizard />;
  if (screen === "review") return <FinalReview />;
  return null;
}

const root = document.getElementById("root");
if (root == null) {
  throw new Error("Could not find #root element");
}

createRoot(root).render(
  <ChakraProvider value={system}>
    <App />
  </ChakraProvider>,
);
