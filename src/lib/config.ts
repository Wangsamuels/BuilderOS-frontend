export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://builderos-api-d6d40e9cc381.herokuapp.com").replace(/\/$/, "");
export const NEAR_NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const NEAR_RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? (NEAR_NETWORK === "testnet" ? "https://rpc.testnet.fastnear.com" : "https://rpc.mainnet.fastnear.com");
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const TEST_SIGNER = process.env.NEXT_PUBLIC_TEST_SIGNER === "1";
export const IS_TESTNET = NEAR_NETWORK === "testnet";
export const TESTNET_FAUCET_URL = "https://near-faucet.io/";
