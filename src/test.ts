import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getOrCreateKeypair, airdropSolIfNeeded } from "./utils";

import {
  closeAccount,
  createInitializeMintInstruction,
  createInitializeMintCloseAuthorityInstruction,
  getMintLen,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeTransferFeeConfigInstruction,
  transferCheckedWithFee,
  createAccount,
  mintTo,
  unpackAccount,
  getTransferFeeAmount,
  withdrawWithheldTokensFromAccounts,
  harvestWithheldTokensToMint,
  withdrawWithheldTokensFromMint,
} from "@solana/spl-token";

describe("Test Wallets", () => {
  // Establish a connection to the Solana devnet cluster
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Declare wallet variable names
  let wallet_1: Keypair;
  let wallet_2: Keypair;

  before(async () => {
    // Use existing keypairs or generate new ones if they don't exist
    wallet_1 = await getOrCreateKeypair("wallet_1");
    wallet_2 = await getOrCreateKeypair("wallet_2");

    // Request an airdrop of SOL to wallet_1 if its balance is less than 1 SOL
    await airdropSolIfNeeded(wallet_1.publicKey);

    console.log(`\n`);
  });

  // it("Create and Close Mint Account", async () => {
  //   const mintKeypair = Keypair.generate();
  //   const mint = mintKeypair.publicKey;

  //   const extensions = [ExtensionType.MintCloseAuthority];
  //   const mintLen = getMintLen(extensions);
  //   const lamports = await connection.getMinimumBalanceForRentExemption(
  //     mintLen
  //   );

  //   // Create transaction with instructions to create new mint account with close authority
  //   const transaction = new Transaction().add(
  //     // Invoke system program to create account, transfer owner to token 2022 program
  //     SystemProgram.createAccount({
  //       fromPubkey: wallet_1.publicKey,
  //       newAccountPubkey: mint,
  //       space: mintLen,
  //       lamports,
  //       programId: TOKEN_2022_PROGRAM_ID,
  //     }),
  //     createInitializeMintCloseAuthorityInstruction(
  //       mint,
  //       wallet_1.publicKey, // close authority
  //       TOKEN_2022_PROGRAM_ID
  //     ),
  //     createInitializeMintInstruction(
  //       mint,
  //       9,
  //       wallet_1.publicKey, // mint authority
  //       wallet_1.publicKey, // freeze authority
  //       TOKEN_2022_PROGRAM_ID
  //     )
  //   );

  //   const txSig = await sendAndConfirmTransaction(connection, transaction, [
  //     wallet_1,
  //     mintKeypair,
  //   ]);

  //   console.log("Create New Mint Account with Close Authority");
  //   console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
  //   console.log(`\n`);

  //   // Close Mint Account
  //   const txSig2 = await closeAccount(
  //     connection,
  //     wallet_1, // payer
  //     mint,
  //     wallet_1.publicKey, // destination (lamports from closed account sent to this address)
  //     wallet_1.publicKey, // close authority
  //     [],
  //     undefined,
  //     TOKEN_2022_PROGRAM_ID
  //   );

  //   console.log("Close Mint Account");
  //   console.log(`https://explorer.solana.com/tx/${txSig2}?cluster=devnet`);
  // });

  it("Create Mint with Transfer Fee", async () => {
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    const extensions = [ExtensionType.TransferFeeConfig];

    const mintLen = getMintLen(extensions);
    const decimals = 9;
    const feeBasisPoints = 50;
    const maxFee = BigInt(5_000);

    const mintLamports = await connection.getMinimumBalanceForRentExemption(
      mintLen
    );

    // Create transaction with instructions to create new mint account with transfer fee
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet_1.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mint,
        wallet_1.publicKey, // authority that can update the fees
        wallet_1.publicKey, // authority that can withdraw fees
        feeBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint,
        decimals,
        wallet_1.publicKey, // mint authority
        null, // freeze authority
        TOKEN_2022_PROGRAM_ID
      )
    );
    const txSig = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet_1, mintKeypair],
      undefined
    );

    console.log(`\n`);
    console.log("Create New Mint Account with Transfer Fee");
    console.log(`https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
    console.log(`\n`);

    const mintAmount = BigInt(1_000_000_000);

    // Associated Token Accounts
    const sourceAccount = await createAccount(
      connection,
      wallet_1, //payer
      mint,
      wallet_1.publicKey, // owner
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Mint Tokens
    await mintTo(
      connection,
      wallet_1, // payer
      mint,
      sourceAccount,
      wallet_1.publicKey, // mint authority
      mintAmount,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Associated Token Account
    const destinationAccount = await createAccount(
      connection,
      wallet_1, // payer
      mint,
      wallet_2.publicKey, // owner
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const transferAmount = BigInt(1_000_000);
    const fee = (transferAmount * BigInt(feeBasisPoints)) / BigInt(10_000);

    // Transfer tokens (with fee)
    const txSig2 = await transferCheckedWithFee(
      connection,
      wallet_1, //payer
      sourceAccount,
      mint,
      destinationAccount,
      wallet_1.publicKey, // owner of source token account
      transferAmount,
      decimals,
      fee,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Transfer Tokens with Fee");
    console.log(`https://explorer.solana.com/tx/${txSig2}?cluster=devnet`);
    console.log(`\n`);

    // Get all Token accounts
    const allAccounts = await connection.getProgramAccounts(
      TOKEN_2022_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: mint.toString(),
            },
          },
        ],
      }
    );

    // Filter for token accounts with fees to withdraw
    const accountsToWithdrawFrom = [];
    for (const accountInfo of allAccounts) {
      const account = unpackAccount(
        accountInfo.pubkey,
        accountInfo.account,
        TOKEN_2022_PROGRAM_ID
      );
      const transferFeeAmount = getTransferFeeAmount(account);
      if (
        transferFeeAmount !== null &&
        transferFeeAmount.withheldAmount > BigInt(0)
      ) {
        accountsToWithdrawFrom.push(accountInfo.pubkey);
      }
    }

    // Withdraw fees
    const txSig3 = await withdrawWithheldTokensFromAccounts(
      connection,
      wallet_1, // payer
      mint,
      destinationAccount,
      wallet_1.publicKey, // withdraw authority
      [],
      [destinationAccount],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Withdraw Fees");
    console.log(`https://explorer.solana.com/tx/${txSig3}?cluster=devnet`);
    console.log(`\n`);

    // Transfer tokens (with fee) again
    const txSig4 = await transferCheckedWithFee(
      connection,
      wallet_1, //payer
      sourceAccount,
      mint,
      destinationAccount,
      wallet_1.publicKey, // owner of source token account
      transferAmount,
      decimals,
      fee,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Transfer Tokens with Fee Again");
    console.log(`https://explorer.solana.com/tx/${txSig4}?cluster=devnet`);
    console.log(`\n`);

    // Transfer withdraw withheld fees from token account to mint
    const txSig5 = await harvestWithheldTokensToMint(
      connection,
      wallet_1, // payer
      mint,
      [destinationAccount],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Harvest Fee from Token Account");
    console.log(`https://explorer.solana.com/tx/${txSig5}?cluster=devnet`);
    console.log(`\n`);

    const txSig6 = await withdrawWithheldTokensFromMint(
      connection,
      wallet_1, // payer
      mint,
      destinationAccount,
      wallet_1.publicKey, // withdraw authority
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Withdraw Fees from Mint Account");
    console.log(`https://explorer.solana.com/tx/${txSig6}?cluster=devnet`);
    console.log(`\n`);
  });
});
