// File: scripts/deployAndSetup.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  const [owner, ...others] = await ethers.getSigners();
  const players = others.slice(0, 100); // 20 "usuarios"

  console.log("Owner:", owner.address);
  console.log("Players:");
  players.forEach((p, i) => console.log(`  [${i}] ${p.address}`));

  const CollateralMock = await ethers.getContractFactory("CollateralMock");
  const collateral = await CollateralMock.deploy(
    "Mock Collateral",
    "MCK",
    18,
    owner.address
  );
  await collateral.waitForDeployment();
  const collateralAddress = await collateral.getAddress();
  console.log("CollateralMock deployed to:", collateralAddress);

  // 2) Deploy BetHouse
  const BetHouse = await ethers.getContractFactory("BetHouse");
  const betHouse = await BetHouse.deploy(collateralAddress, owner.address);
  await betHouse.waitForDeployment();
  const betHouseAddress = await betHouse.getAddress();
  console.log("BetHouse deployed to:", betHouseAddress);


  const initialBalance = ethers.parseEther("100000");

  for (const p of players) {
    const txMint = await collateral.mint(p.address, initialBalance);
    await txMint.wait();

    const txApprove = await collateral
      .connect(p)
      .approve(betHouseAddress, initialBalance);
    await txApprove.wait();

    console.log(`Player ${p.address} listo (mint + approve)`);
  }

  console.log("\nDeploy + setup completo.");
  console.log("  Collateral:", collateralAddress);
  console.log("  BetHouse  :", betHouseAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

