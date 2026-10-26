/**
 * Deploys the four Credloom contracts, wires them together and exports
 *   - blockchain-service/abi/*.json      (ABIs consumed by web3.py)
 *   - blockchain-service/deployment.json (addresses + chain info)
 *
 * Usage:
 *   npx hardhat node                                  (terminal 1)
 *   npx hardhat run scripts/deploy.js --network localhost   (terminal 2)
 */
const fs = require("fs");
const path = require("path");
const { ethers, artifacts, network } = require("hardhat");

const SERVICE_DIR = path.join(__dirname, "..", "..", "blockchain-service");
const GRACE_PERIOD = Number(process.env.GRACE_PERIOD_SECONDS || 0);

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();
  console.log("Deployer (protocol signer):", deployer.address);
  console.log("Chain id:", chain.chainId.toString(), "| network:", network.name);

  const deploy = async (name, ...args) => {
    const factory = await ethers.getContractFactory(name);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`${name.padEnd(20)} ${address}`);
    return contract;
  };

  const registry = await deploy("ReputationRegistry");
  const insurance = await deploy("InsurancePool");
  const escrow = await deploy(
    "LoanEscrow",
    await registry.getAddress(),
    await insurance.getAddress(),
    GRACE_PERIOD
  );
  const pool = await deploy("LenderLiquidityPool");

  // One-shot wiring (owner only)
  await (await registry.setLoanEscrowContract(await escrow.getAddress())).wait();
  await (await insurance.setLoanEscrowContract(await escrow.getAddress())).wait();
  await (await escrow.setLiquidityPool(await pool.getAddress())).wait();
  await (await pool.setLoanEscrow(await escrow.getAddress())).wait();
  await (await pool.setProtocol(deployer.address)).wait();
  console.log("Contracts wired.");

  const deployment = {
    chainId: Number(chain.chainId),
    network: network.name,
    deployedAt: new Date().toISOString(),
    gracePeriodSeconds: GRACE_PERIOD,
    protocol: deployer.address,
    contracts: {
      ReputationRegistry: await registry.getAddress(),
      InsurancePool: await insurance.getAddress(),
      LoanEscrow: await escrow.getAddress(),
      LenderLiquidityPool: await pool.getAddress(),
    },
  };

  // Export ABIs + addresses for the blockchain service
  const abiDir = path.join(SERVICE_DIR, "abi");
  fs.mkdirSync(abiDir, { recursive: true });
  for (const name of Object.keys(deployment.contracts)) {
    const artifact = await artifacts.readArtifact(name);
    fs.writeFileSync(path.join(abiDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2));
  }
  fs.writeFileSync(path.join(SERVICE_DIR, "deployment.json"), JSON.stringify(deployment, null, 2));
  fs.mkdirSync(path.join(__dirname, "..", "deployments"), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, "..", "deployments", `${network.name}.json`),
    JSON.stringify(deployment, null, 2)
  );
  console.log("Exported ABIs and deployment.json to blockchain-service/");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
