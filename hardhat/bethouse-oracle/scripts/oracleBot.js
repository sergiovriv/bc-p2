// scripts/oracleBotReports.js

const hre = require("hardhat");
const { ethers } = hre;
const axios = require("axios");
const readline = require("readline");


async function getKuboClient() {
  const { create } = await import("kubo-rpc-client");
  return create("/ip4/127.0.0.1/tcp/5001");
}

const ROUND_SECONDS = 40;
const BET_WINDOW_SECONDS = 20;
const NUM_ROUNDS = 20;
const HEARTBEAT_EVERY_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}


async function getChainTime() {
  const block = await ethers.provider.getBlock("latest");
  return Number(block.timestamp);
}


let simulatedPrice = 90000;

function nextSimulatedPrice() {
  const delta = (Math.random() - 0.5) * 500;
  simulatedPrice = Math.max(1000, simulatedPrice + delta);
  const rounded = Math.round(simulatedPrice * 100) / 100;
  console.log(`  [FAKE] BTC sim price: ${rounded} USD`);
  return rounded;
}

async function getBtcPrice() {
  const url = "https://api.coingecko.com/api/v3/simple/price";

  try {
    const res = await axios.get(url, {
      params: { ids: "bitcoin", vs_currencies: "usd" },
      timeout: 5000,
    });
    const price = res?.data?.bitcoin?.usd;
    if (typeof price !== "number") throw new Error("API sin precio numérico");
    console.log(`  [API] BTC price: ${price} USD`);
    return price;
  } catch (e) {
    const status = e?.response?.status;
    console.log(
      `  [API] Error (${status || e.code || e.message}). Usando precio simulado...`
    );
    return nextSimulatedPrice();
  }
}


async function heartbeatTx(players, collateral) {
  const fromIndex = Math.floor(Math.random() * players.length);
  let toIndex = Math.floor(Math.random() * players.length);
  if (toIndex === fromIndex) toIndex = (toIndex + 1) % players.length;

  const from = players[fromIndex];
  const to = players[toIndex];
  const amount = ethers.parseEther("1");

  try {
    const tx = await collateral.connect(from).transfer(to.address, amount);
    await tx.wait();
    console.log(
      `  [HB] Transfer 1 MCK ${from.address.slice(0, 8)} -> ${to.address.slice(
        0,
        8
      )}`
    );
  } catch (e) {
    console.log("  [HB] Heartbeat fallido (se ignora):", e.message);
  }
}

async function runRound(roundIdx, owner, players, betHouse, collateral, storage, ipfsClient) {
  console.log(`\n=== RONDA ${roundIdx} (tiempo real, on-chain) ===`);


  const txStart = await betHouse.connect(owner).startRound();
  await txStart.wait();

  const currentRoundId = await betHouse.currentRoundId();
  const r0 = await betHouse.rounds(currentRoundId);

  const startTime = Number(r0.startTime);
  const endTime = Number(r0.endTime);

  console.log("Round id            :", currentRoundId.toString());
  console.log("startTime (on-chain):", startTime);
  console.log("endTime   (on-chain):", endTime);


  const priceStart = await getBtcPrice();
  console.log("Precio BTC inicio   :", priceStart, "USD");

  const amountYes = ethers.parseEther("10");
  const amountNo = ethers.parseEther("10");

  const yesPlayers = players.slice(0, 10);
  const noPlayers = players.slice(10);

  let yesIndex = 0;
  let noIndex = 0;

  const bets = [];
  const feeBps = await betHouse.FEE_BET_BPS();
  const FEE_DENOM = 10_000n;


  while (true) {
    const nowSec = await getChainTime();
    const elapsed = nowSec - startTime;
    const remaining = endTime - nowSec;

    console.log(
      `\n[tick] chainNow=${nowSec} elapsed=${elapsed}s remaining=${remaining}s`
    );

    if (elapsed >= 0 && elapsed <= BET_WINDOW_SECONDS) {
      console.log("  Dentro de ventana de apuestas.");
      let betsThisTick = 0;

      // YES
      while (yesIndex < yesPlayers.length && betsThisTick < 3) {
        const p = yesPlayers[yesIndex++];
        const tx = await betHouse.connect(p).betYes(currentRoundId, amountYes);
        await tx.wait();

        const gross = amountYes;
        const fee = (gross * feeBps) / FEE_DENOM;
        const net = gross - fee;

        bets.push({
          address: p.address,
          side: "YES",
          gross: ethers.formatEther(gross),
          net: ethers.formatEther(net),
          txHash: tx.hash,
        });

        console.log(
          `  [BET] YES 10 MCK from ${p.address.slice(0, 8)} (idx=${yesIndex})`
        );
        betsThisTick++;
      }

      // NO
      while (noIndex < noPlayers.length && betsThisTick < 6) {
        const p = noPlayers[noIndex++];
        const tx = await betHouse.connect(p).betNo(currentRoundId, amountNo);
        await tx.wait();

        const gross = amountNo;
        const fee = (gross * feeBps) / FEE_DENOM;
        const net = gross - fee;

        bets.push({
          address: p.address,
          side: "NO",
          gross: ethers.formatEther(gross),
          net: ethers.formatEther(net),
          txHash: tx.hash,
        });

        console.log(
          `  [BET] NO  10 MCK from ${p.address.slice(0, 8)} (idx=${noIndex})`
        );
        betsThisTick++;
      }

      if (betsThisTick === 0) {
        console.log("  [BET] No quedan jugadores nuevos para apostar.");
      }
    } else {
      console.log("  Fuera de ventana de apuestas.");
    }

    if (nowSec >= endTime) {
      console.log("  Hemos alcanzado endTime on-chain. Vamos a resolver la ronda.");
      break;
    }

    await heartbeatTx(players, collateral);
    await sleep(HEARTBEAT_EVERY_MS);
  }


  const priceEnd = await getBtcPrice();
  console.log("Precio BTC final    :", priceEnd, "USD");

  const outcomeYes = priceEnd > priceStart;
  console.log("OutcomeYes          :", outcomeYes);


  const txEnd = await betHouse
    .connect(owner)
    .endRound(currentRoundId, outcomeYes);
  await txEnd.wait();
  const resolvedAt = await getChainTime();

  console.log("Ronda cerrada on-chain.");

  const r = await betHouse.rounds(currentRoundId);
  console.log("  refundMode:", r.refundMode);
  console.log("  outcomeYes:", r.outcomeYes);
  console.log("  totalYesNet:", ethers.formatEther(r.totalYesNet));
  console.log("  totalNoNet :", ethers.formatEther(r.totalNoNet));

  const winnersSide = outcomeYes ? "YES" : "NO";

  const reportBets = bets.map((b) => ({
    ...b,
    winner: !r.refundMode && b.side === winnersSide,
  }));

  const report = {
    roundId: currentRoundId.toString(),
    oracleAddress: owner.address,
    betHouseAddress: await betHouse.getAddress(),
    collateralAddress: await collateral.getAddress(),
    startTime,
    endTime,
    resolvedAt,
    roundSeconds: ROUND_SECONDS,
    betWindowSeconds: BET_WINDOW_SECONDS,
    btcPriceStart: priceStart,
    btcPriceEnd: priceEnd,
    outcomeYes,
    refundMode: r.refundMode,
    totals: {
      totalYesNet: ethers.formatEther(r.totalYesNet),
      totalNoNet: ethers.formatEther(r.totalNoNet),
      feeAccrued: ethers.formatEther(r.feeAccrued),
    },
    bets: reportBets,
  };

// 6) Subir JSON a IPFS con kubo-rpc-client
const json = JSON.stringify(report, null, 2);
console.log("  [IPFS] Subiendo reporte de ronda a IPFS...");

const file = await ipfsClient.add({
  path: `round-${report.roundId}.json`,
  content: Buffer.from(json),
});

const cidStr = file.cid.toString();
console.log("  [IPFS] file:", file.path, "cid:", cidStr);

const mfsDir = "/round-reports";
const mfsPath = `${mfsDir}/round-${report.roundId}.json`;

try {

  await ipfsClient.files.mkdir(mfsDir, { parents: true });
} catch (e) {

}

try {
  await ipfsClient.files.cp(`/ipfs/${cidStr}`, mfsPath);
  console.log("  [IPFS] Copiado a MFS:", mfsPath);
} catch (e) {
  console.log("  [IPFS] Error copiando a MFS (se ignora):", e.message);
}


  const txStore = await storage
    .connect(owner)
    .setRoundReport(currentRoundId, cidStr);
  await txStore.wait();

  console.log(
    `  [STORAGE] IpfsRoundStorage.setRoundReport(${currentRoundId}, ${cidStr}) OK`
  );
}

async function main() {
  const [owner, ...others] = await ethers.getSigners();
  const players = others.slice(0, 20);

  let betHouseAddress = process.env.BET_HOUSE_ADDRESS;
  let collateralAddress = process.env.COLLATERAL_ADDRESS;
  let storageAddress = process.env.IPFS_STORAGE_ADDRESS;

  if (!betHouseAddress) {
    betHouseAddress = await ask("Introduce la dirección de BetHouse: ");
  }
  if (!collateralAddress) {
    collateralAddress = await ask("Introduce la dirección de CollateralMock: ");
  }
  if (!storageAddress) {
    storageAddress = await ask(
      "Introduce la dirección de IpfsRoundStorage: "
    );
  }

  if (
    !ethers.isAddress(betHouseAddress) ||
    !ethers.isAddress(collateralAddress) ||
    !ethers.isAddress(storageAddress)
  ) {
    throw new Error("Alguna de las direcciones introducidas no es válida");
  }

  const betHouse = await ethers.getContractAt("BetHouse", betHouseAddress);
  const collateral = await ethers.getContractAt(
    "CollateralMock",
    collateralAddress
  );
  const storage = await ethers.getContractAt(
    "IpfsRoundStorage",
    storageAddress
  );

  const ipfsClient = await getKuboClient();

  console.log("\n=== CONFIG ORACLE+IPFS+STORAGE ===");
  console.log("Owner (oracle):", owner.address);
  console.log("BetHouse      :", await betHouse.getAddress());
  console.log("Collateral    :", await collateral.getAddress());
  console.log("IpfsStorage   :", await storage.getAddress());
  console.log("==================================\n");

  for (let i = 1; i <= NUM_ROUNDS; i++) {
    await runRound(i, owner, players, betHouse, collateral, storage, ipfsClient);
  }

  console.log(
    "\nTodas las rondas simuladas, reportes subidos a IPFS y CIDs guardados en IpfsRoundStorage."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

