import { ChakraProvider } from "@chakra-ui/react";
import { createRoot } from "react-dom/client";
import { useObservable } from "./observable";
import { model } from "./state/model";
import { system } from "./theme";
import { SetupScreen } from "./ui/SetupScreen";
import { LatencyCalibrationScreen } from "./ui/LatencyCalibrationScreen";
import { RecordingWizard } from "./ui/RecordingWizard";
import { FinalReview } from "./ui/FinalReview";

function App() {
  const bootstrapped = useObservable(model.bootstrapped);
  const screen = useObservable(model.appScreen);

  if (!bootstrapped) return null;

  if (screen === "setup") return <SetupScreen />;
  if (screen === "calibration") return <LatencyCalibrationScreen />;
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
