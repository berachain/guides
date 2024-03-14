import { Container, Flex, Heading, Link, Switch, useColorMode } from "@chakra-ui/react";
import { ConnectWallet } from "@thirdweb-dev/react";

export default function NavBar() {
  const { colorMode, toggleColorMode } = useColorMode();

  return (
    <Container maxW={"1200px"} py={4}>
      <Flex direction={"row"} justifyContent={"space-between"}>
        <Heading>BeraCrypt Farm</Heading>
        <Flex alignItems={"center"}>
          <Link href={"/"} mx={3} fontSize="xl" _hover={{
            textDecoration: "none",
            border: "1px solid black",
            borderRadius: "3px",
            bg: colorMode === "light" ? "green.200" : "green.600", // Change background color based on color mode
          }}>Play</Link>
          <Link href={"/shop"} mx={3} fontSize="xl" _hover={{
            textDecoration: "none",
            border: "2px solid black",
            borderRadius: "3px",
            bg: colorMode === "light" ? "blue.200" : "blue.600", // Change background color based on color mode
          }}>Shop</Link>
          <Switch size="md" colorScheme="teal" onChange={toggleColorMode} ml={3}/> {/* Add a switch to toggle between light and dark modes */}
        </Flex>
        <ConnectWallet/>
      </Flex>
    </Container>
  )
};