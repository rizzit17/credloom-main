require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    // `npx hardhat node` exposes this on http://127.0.0.1:8545
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
  },
  // Hardhat's default chain id; automine so every tx is a block we can show in the UI.
  paths: { sources: "./contracts", tests: "./test" },
};
