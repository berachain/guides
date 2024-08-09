import hre, { deployments, getNamedAccounts } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const isHardhat = hre.network.name === "hardhat";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  console.log("deploying SimpleVRFContract");
  const { deployer } = await getNamedAccounts();
  const dedicatedMsgSender = "0xa55e7F0dD850C5353025d3cFA5a36e648635a256";
  console.log("deployer", deployer);

  if (!isHardhat) {
    console.log(
      `\nDeploying SimpleVRFContract to ${hre.network.name}. Hit ctrl + c to abort`
    );
  }

  await deploy("SimpleVRFContract", {
    from: deployer,
    log: !isHardhat,
    args: [dedicatedMsgSender],
  });
};

func.tags = ["SimpleVRFContract"];

export default func;
