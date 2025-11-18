// scripts/deployIpfsStorage.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [owner] = await ethers.getSigners();

  console.log("Owner:", owner.address);

  const IpfsRoundStorage = await ethers.getContractFactory("IpfsRoundStorage");
  const storage = await IpfsRoundStorage.deploy(owner.address);
  await storage.waitForDeployment();

  const addr = await storage.getAddress();
  console.log("IpfsRoundStorage deployed to:", addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
