import { ChakraProvider } from "@chakra-ui/react";
import { createRoot } from "react-dom/client";
import { system } from "./theme";

function App() {
  return <div>Hello, Hum!</div>;
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
