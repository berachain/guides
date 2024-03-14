import { MediaRenderer, Web3Button, useAddress, useContract, useContractRead, useNFT } from "@thirdweb-dev/react";
import { STAKING_ADDRESS, TOOLS_ADDRESS } from "../const/addresses";
import { ethers } from "ethers";
import styles from "../styles/Home.module.css";
import { Text, Box, Card, Stack, Flex } from "@chakra-ui/react";

interface EquippedProps {
    tokenId: number;
};

export const Equipped: React.FC<EquippedProps> = (props) => {
    const address = useAddress();
  
    const { contract: toolContract } = useContract(TOOLS_ADDRESS);
    const { data: nft } = useNFT(toolContract, props.tokenId);
  
    const { contract: stakingContract } = useContract(STAKING_ADDRESS);
  
    const { data: claimableRewards } = useContractRead(
      stakingContract,
      "getStakeInfoForToken",
      [props.tokenId, address]
    );
  
    return (
      <Box>
        {nft && (
          <Card className={styles.equipcontainer} p={5}>
            <Flex>
              <Box>
                <MediaRenderer
                  src={nft.metadata.image}
                  height="80%"
                  width="80%"
                />
              </Box>
              <Stack spacing={1}>
                <Text fontSize={"2xl"} fontWeight={"bold"}>{nft.metadata.name}</Text>
                {claimableRewards && (
                  <>
                    <Text>Equipped: {ethers.utils.formatUnits(claimableRewards[0], 0)}</Text>
                    <Web3Button
                      contractAddress={STAKING_ADDRESS}
                      action={(contract) => contract.call("withdraw", [props.tokenId, 1])}
                      className={styles.unequipbutton}
                    >Unequip</Web3Button>
                  </>
                )}
              </Stack>
            </Flex>
            <Box mt={5}>
              <Text>Claimable USDT:</Text>
              {claimableRewards && (
                <Text>{ethers.utils.formatUnits(claimableRewards[1], 18)}</Text>
              )}
              {claimableRewards && (
                <Web3Button
                  contractAddress={STAKING_ADDRESS}
                  action={(contract) => contract.call("claimRewards", [props.tokenId])}
                >Claim $USDT</Web3Button>
              )}
            </Box>
          </Card>
        )}
      </Box>
    );
  };