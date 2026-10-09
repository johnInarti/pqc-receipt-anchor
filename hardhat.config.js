require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Deployer key from the environment only (never committed). Falls back to a dummy key so `npx hardhat test`
// works without any .env.
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    hardhat: { chainId: 31337 },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: [PRIVATE_KEY],
      chainId: 421614,
    },
    arbitrumOne: {
      url: process.env.ARBITRUM_ONE_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts: [PRIVATE_KEY],
      chainId: 42161,
    },
  },
  etherscan: {
    apiKey: { arbitrumSepolia: process.env.ARBISCAN_KEY || "", arbitrumOne: process.env.ARBISCAN_KEY || "" },
    customChains: [
      { network: "arbitrumSepolia", chainId: 421614, urls: { apiURL: "https://api-sepolia.arbiscan.io/api", browserURL: "https://sepolia.arbiscan.io" } },
      { network: "arbitrumOne", chainId: 42161, urls: { apiURL: "https://api.arbiscan.io/api", browserURL: "https://arbiscan.io" } },
    ],
  },
  sourcify: { enabled: true },
};
