const fs = require("fs");
const path = require('path');
require("@nomiclabs/hardhat-ethers");
require("@nomicfoundation/hardhat-foundry");
require("dotenv-defaults").config();
require("./tasks");
const { createProvider } = require("hardhat/internal/core/providers/construction");
const { getForgeConfig } = require("@nomicfoundation/hardhat-foundry/dist/src/foundry");
const {
  glob
} = require('glob');

const foundry = getForgeConfig();

let accounts;

if (process.env.PRIVATE_KEY) {
  accounts = [process.env.PRIVATE_KEY];
} else {
  accounts = {
    mnemonic:
      process.env.MNEMONIC ||
      "test test test test test test test test test test test junk",
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  foundry,
  defaultNetwork: "mainnet",
  solidity: {
    compilers: [
      {
        version: foundry.solc,
        settings: {
          optimizer: {
            enabled: foundry.optimizer,
            runs: foundry.optimizer_runs
          }
        }
      }
    ]
  },
  namedAccounts: {
    deployer: {
      default: 0,
    }
  },
  networks: {
    mainnet: {
      url: process.env.MAINNET_RPC_URL,
      api_key: process.env.MAINNET_ETHERSCAN_KEY,
      chainId: 1,
      lzChainId: 101,
      accounts,
      mimLzSupported: true
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL,
      api_key: process.env.ARBITRUM_ETHERSCAN_KEY,
      chainId: 42161,
      lzChainId: 110,
      accounts,
      forgeDeployExtraArgs: "--legacy",
      mimLzSupported: true
    },
    blast: {
      url: process.env.BLAST_RPC_URL,
      api_key: process.env.BLAST_ETHERSCAN_KEY,
      chainId: 81457,
      lzChainId: 243,
      accounts
    }
  }
};

extendEnvironment((hre) => {
  const providers = {};

  hre.getNetworkConfigByName = (name) => {
    return hre.config.networks[name];
  };

  hre.getNetworkConfigByChainId = (chainId) => {
    const config = hre.findNetworkConfig((config) => config.chainId === chainId);

    if (!config) {
      console.error(`ChainId: ${chainId} not found in hardhat.config.js`);
      process.exit(1);
    }

    return config;
  };

  hre.getNetworkConfigByLzChainId = (lzChainId) => {
    const config = hre.findNetworkConfig((config) => config.lzChainId === lzChainId);

    if (!config) {
      console.error(`LzChainId: ${lzChainId} not found in hardhat.config.js`);
      process.exit(1);
    }

    return config;
  };

  hre.getAllNetworks = () => {
    return Object.keys(hre.config.networks);
  }

  hre.getAllNetworksLzMimSupported = () => {
    return Object.keys(hre.config.networks).filter(name => hre.config.networks[name].mimLzSupported);
  }

  hre.findNetworkConfig = (predicate) => {
    // loop thru all hre.config.networks and find the one with the matching chainId
    for (const [name, config] of Object.entries(hre.config.networks)) {
      if (predicate(config)) {
        return {
          name,
          ...config
        }
      }
    }
  };

  hre.getLzChainIdByNetworkName = (name) => {
    return getNetworkConfigByName(name).lzChainId;
  };

  hre.getChainIdByNetworkName = (name) => {
    return getNetworkConfigByName(name).chainId;
  };

  hre.getArtifact = async (artifact) => {
    const [filepath, name] = artifact.split(':');
    const file = `./${foundry.out}/${path.basename(filepath)}/${name}.json`;

    if (!fs.existsSync(file)) {
      console.error(`Artifact ${artifact} not found (${file})`);
      process.exit(1);
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  hre.deploymentExists = (name, chainId) => {
    return fs.existsSync(`./deployments/${chainId}/${name}.json`);
  }

  hre.getDeployment = async (name, chainId) => {
    const file = `./deployments/${chainId}/${name}.json`;

    if (!fs.existsSync(file)) {
      console.error(`ChainId: ${chainId} does not have a deployment for ${name}. (${file} not found)`)
      process.exit(1);
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };

  hre.getAbi = async (artifactName) => {
    const file = (await glob(`${foundry.out}/**/${artifactName}.json`))[0];
    if (!file) {
      console.error(`Artifact ${artifactName} not found inside ${foundry.out}/ folder`);
      process.exit(1);
    }

    return (JSON.parse(fs.readFileSync(file, 'utf8'))).abi;
  };

  hre.getSigners = async () => {
    return await hre.ethers.getSigners();
  };

  hre.getDeployer = async () => {
    return (await getSigners())[0];
  };

  hre.getContractAt = async (artifactName, address) => {
    const signer = (await getSigners())[0];
    const abi = await getAbi(artifactName);
    return await ethers.getContractAt(abi, address, signer);
  };

  hre.getContract = async (name, chainId) => {
    const previousNetwork = getNetworkConfigByChainId(hre.network.config.chainId);
    const currentNetwork = getNetworkConfigByChainId(chainId);
    chainId = chainId || previousNetwork.chainId;

    if (!chainId) {
      console.error("No network specified, use `changeNetwork` to switch network or specify --network parameter.");
      process.exit(1);
    }

    if (chainId != previousNetwork.chainId) {
      await hre.changeNetwork(currentNetwork.name);
    }

    const deployment = await getDeployment(name, chainId);
    const signer = (await hre.ethers.getSigners())[0];
    const contract = await ethers.getContractAt(deployment.abi, deployment.address, signer);

    if (chainId != previousNetwork.chainId) {
      await hre.changeNetwork(previousNetwork.name);
    }

    return contract;
  };

  // create all network providers so it's easy to switch between them.
  // Adapted from https://github.com/dmihal/hardhat-change-network/
  hre.getProvider = (name) => {
    if (!providers[name]) {
      providers[name] = createProvider(
        name,
        hre.config.networks[name],
        hre.config.paths,
        hre.artifacts,
      );
    }
    return providers[name];
  };

  hre.changeNetwork = (networkName) => {
    if (!hre.config.networks[networkName]) {
      throw new Error(`changeNetwork: Couldn't find network '${networkName}'`);
    }

    if (!providers[hre.network.name]) {
      providers[hre.network.name] = hre.network.provider;
    }

    hre.network.name = networkName;
    hre.network.config = hre.config.networks[networkName];

    if (!providers[networkName]) {
      providers[networkName] = createProvider(
        networkName,
        hre.config.networks[networkName],
        hre.config.paths,
        hre.artifacts,
      );
    }

    hre.network.provider = providers[networkName];

    if (hre.ethers) {
      const { EthersProviderWrapper } = require("@nomiclabs/hardhat-ethers/internal/ethers-provider-wrapper");
      hre.ethers.provider = new EthersProviderWrapper(hre.network.provider);
    }
  };

  delete hre.config.networks.hardhat;
  delete hre.config.networks.localhost;

  // remove hardhat core tasks
  delete hre.tasks.compile;
  delete hre.tasks.test;
  delete hre.tasks.run;
  delete hre.tasks.clean;
  delete hre.tasks.accounts;
  delete hre.tasks.console;
  delete hre.tasks.node;
  delete hre.tasks.check;
  delete hre.tasks.flatten;
  delete hre.tasks["init-foundry"]
});
