import { useColorMode, Switch, useColorModeValue } from "@chakra-ui/react";

export const useDarkMode = () => {
  const { toggleColorMode } = useColorMode();
  const colorMode = useColorModeValue('light', 'dark'); // Add default values here

  return {
    colorMode,
    toggleDarkMode: () => toggleColorMode(),
  };
};