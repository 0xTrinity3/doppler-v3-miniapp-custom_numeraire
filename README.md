# Doppler V3 MiniApp

A React-based mini application built with Vite, TypeScript, and Tailwind CSS. This project provides an easy to get started with UI for interacting with the [Doppler liquidity bootstrapping protocol](https://docs.doppler.lol/).

## Features

- Interact with the Doppler liquidity bootstrapping protocol.
- Deploy new Doppler liquidity pools.
- Swap tokens through deployed Doppler pools.
- **Custom ERC20 Numeraire Support:** Deploy Doppler pools and execute swaps using a user-specified ERC20 token as the numeraire.

### Default Pool Parameters

When deploying a new pool, the "Advanced Options" section is optional. If you do not provide any values, the following default parameters will be used:

- **Pool Configuration:**
  - **Start Tick:** `175000`
  - **End Tick:** `225000`
  - **Number of Positions:** `15`
  - **Max Share to be Sold:** `35%`
  - **Fee:** `1%`
- **Sale Configuration:**
  - **Initial Supply:** `1,000,000,000` tokens
  - **Number of Tokens to Sell:** `900,000,000` tokens
- **Creator Token Allocation (Default Deployment):**
  When deploying a pool using the default settings, the creator's tokens are allocated as follows, based on Doppler SDK mechanisms:

  1.  **`Airlock` Contract & Initial Token Custody:**
      - A new `Airlock` contract is deployed for your pool. Your EOA (the deploying wallet, e.g., `0x82f...EA1`) becomes its owner.
      - The DERC20 token mints `DEFAULT_INITIAL_SUPPLY_WAD - DEFAULT_PRE_MINT_WAD` (i.e., `1,000,000,000 - 9,000,000 = 991,000,000`) tokens to this `Airlock` contract. (The Airlock's address can be found in deployment logs as the recipient of this large mint and as the new DERC20 owner).
      - **These 991M tokens initially reside in the `Airlock`, not your EOA.**

  2.  **`Airlock`'s Role in Pool Seeding:**
      - The `Airlock` contract is responsible for seeding the Uniswap V3 liquidity pool.
      - When its `migrate()` function is called (typically triggered by the "Graduate Pool" action in the UI), the `Airlock` will transfer `tokensToSellWad` (default: `900,000,000`) from its 991M token balance to the `LiquidityMigrator` contract.
      - The `LiquidityMigrator` then uses these 900M tokens (plus numeraire) to create the actual pool on Uniswap V3.

  3.  **Net Creator Tokens from `Airlock`:**
      - After the `Airlock` has fulfilled its duty of providing tokens for the sale/pool, the remaining balance in the `Airlock` is:
        `991,000,000 (initial) - 900,000,000 (for pool) = 91,000,000` tokens.
      - These **91,000,000 tokens** are the creator's net allocation from the `Airlock`. As the `Airlock` owner, you can then interact with the `Airlock` contract (e.g., via its `execute` function or specific withdrawal functions) to transfer these 91M tokens to your EOA or elsewhere.

  4.  **Pre-Mint Allocation (Claimable from DERC20 Token):**
      - Separately, `DEFAULT_PRE_MINT_WAD` (`9,000,000` tokens) are allocated to your EOA as a vesting schedule *within the DERC20 token contract itself*.
      - **How to Claim:** These 9 million tokens are **claimable immediately and in full** by your EOA. To claim them:
        1. You need the address of your newly deployed DERC20 token (this is the token for which you created the pool).
        2. Interact with this DERC20 token contract directly (e.g., using a block explorer like BaseScan by navigating to the token's address and using the "Write Contract" functions).
        3. Call the `release(amount)` function on the DERC20 token, specifying the amount you wish to claim (up to 9,000,000). You can check the claimable amount using `computeAvailableVestedAmount(yourCreatorAddress)`.

  5.  **Total Creator Discretionary Tokens (Default):**
      - `91,000,000` (net from `Airlock` after pool seeding)
      - `+ 9,000,000` (claimable directly from the DERC20 token contract)
      - `= 100,000,000` tokens.

  - **Yearly Mint Rate (DERC20 Token Feature):** `2%` (`DEFAULT_YEARLY_MINT_RATE_WAD`).
    - The DERC20 token contract includes a `mintInflation()` function that allows for a potential annual inflation of up to 2% of the total supply. The authority to call this function, and thus mint new tokens, is managed through a standard DAO governance process:

1.  **Initial Ownership (Pre-Graduation):** Upon deployment, the `Airlock` contract (deployed by you, the creator) is the initial owner of the DERC20 token. At this stage, technically only the `Airlock` could call `mintInflation()`. However, its role is to facilitate deployment and then transfer control.
2.  **Ownership Transfer (Post-Graduation):** When the pool is "graduated" (by calling `Airlock.migrate()`), the `Airlock` contract transfers ownership of the DERC20 token to the `TimelockController` contract that was deployed alongside the `Governance` contract.
3.  **DAO Control (Post-Graduation):**
    *   The `TimelockController` contract acts as the owner of the DERC20 token.
    *   The `Governance` contract (representing the DAO) is the sole entity authorized to propose and execute actions through the `TimelockController`.
    *   Therefore, after pool graduation, the **DAO (DERC20 token holders voting via the `Governance` contract) has exclusive control over the `mintInflation()` function.** Decisions to mint inflation tokens must pass a DAO vote.

This ensures that any inflation is subject to the collective decision-making of the token holders, aligning with decentralized governance principles.

### Governance Configuration

The deployment process also establishes a decentralized autonomous organization (DAO) to govern the DERC20 token and associated pool parameters over time. Key governance parameters, some of which can be configured under "Advanced Options" during deployment, are as follows:

*   **DERC20 Token:** This is the token used for voting in the DAO.
*   **Governor Contract (`Governance.sol`):** This contract manages the proposal and voting process. It's a standard OpenZeppelin Governor.
*   **Timelock Contract (`TimelockController.sol`):** This contract enforces a delay on executed proposals, providing a window for review. It is the ultimate owner of the DERC20 token post-graduation and executes proposals passed by the Governor.

**Default Governance Parameters (from `ReadWriteFactory.ts` and contracts):**

*   **Initial Voting Delay:** `0` (proposals can be voted on immediately after creation).
    *   *Note:* This is the delay *before* voting starts. The `Governance.sol` contract also imposes a **90-day embargo period** after deployment during which *no proposals can be created at all*.
*   **Initial Voting Period:** `7 days` (specifically `604,800` which the OpenZeppelin Governor interprets as blocks. The duration in days/hours depends on the underlying blockchain's average block time).
*   **Initial Proposal Threshold:** `0 DERC20 tokens` (any token holder can create a proposal, regardless of their balance, though they still need voting power to pass it).
*   **Quorum:** `8%` of the total DERC20 supply. For a proposal to pass, at least 8% of all DERC20 tokens must participate in the vote (and 'yes' votes must exceed 'no' votes).
*   **Timelock Delay:** `1 day`. Once a proposal is successfully voted on, it must wait in the Timelock for 1 day before it can be executed.

These parameters ensure a structured and transparent process for making changes or taking actions like minting inflation tokens.

**Treasury from Raised Assets:**

When the pool is graduated (via `Airlock.migrate()`), the numeraire tokens (e.g., ETH, USDC) raised from the initial sale, along with any unsold DERC20 tokens, are used to provide liquidity to a new Uniswap V2 pool. The resulting Uniswap V2 Liquidity Provider (LP) tokens represent this pooled capital.

*   **95% of these LP tokens are transferred directly to the `TimelockController` contract.** Since the `Governance` contract (the DAO) controls the Timelock, this means the DAO effectively owns and controls the primary treasury generated from the token sale.
*   The remaining 5% of the LP tokens are sent to a `UniswapV2Locker` contract, likely to ensure some baseline liquidity remains locked for a period, with the DAO as the ultimate beneficiary.

Decisions regarding the management or use of these LP tokens in the Timelock (e.g., holding, selling for other assets, using for ecosystem incentives) are subject to DAO proposals and votes.

**Mutability of Governance Parameters:**

While initial defaults are set, some governance parameters can be changed by the DAO itself through successful governance proposals:

*   **Quorum:** The default 8% quorum can be increased or decreased by a DAO vote targeting the `updateQuorumNumerator` function on the Governor contract.
*   Other parameters like `votingDelay`, `votingPeriod`, and `proposalThreshold` can also typically be modified via proposals if the Governor contract exposes functions for their update (which standard OpenZeppelin Governors like `GovernorSettings` do, e.g., `setVotingDelay`, `setVotingPeriod`, `setProposalThreshold`).

### Calculating Start and End Ticks

The start and end ticks for a new pool are determined by the desired price range for the token during the initial liquidity bootstrapping phase (the sale). Here's a step-by-step guide using an example:

**1. Define Your Goal:**

*   **Target Market Cap:** The desired initial valuation of the tokens you are putting up for sale (e.g., `$5,000`). This is the "Target Fully Diluted Market Cap" you set on the deployment page.
*   **Number of Tokens to Sell:** The total number of your tokens you will add to the pool. The default from the SDK is `900,000,000` DERC20 tokens (this is the `DEFAULT_NUM_TOKENS_TO_SELL_WAD` value).
*   **Numeraire Token Price:** The stable price of your chosen numeraire token (e.g., a custom stablecoin at `$0.02` or USDC usually at `$1.00`).

**2. Calculate the Target Initial Price:**

Determine the price per token needed to achieve your target market cap with the tokens being sold.
*   **Formula:** `Initial Token Price = Target Market Cap / Number of Tokens to Sell`
*   **Example (using $5,000 Target Market Cap and 900M tokens to sell):**
    `$5,000 / 900,000,000 tokens = $0.00000555556...` per token.

**3. Calculate the Price Ratio (Token Price relative to Numeraire Price):**

The price must be expressed as a ratio of your token's price to the numeraire token's price.
*   **Formula:** `Price Ratio = Initial Token Price / Numeraire Token Price`
*   **Example (assuming Numeraire Token Price is $0.02):**
    `$0.00000555556 / $0.02 = 0.000277778`

**4. Convert Price Ratio to a Central Tick:**

This price ratio corresponds to a specific price tick in the Uniswap V3 system. This tick will be the conceptual center of your liquidity range.
*   **Formula (simplified):** `tick = log_base_1.0001 (Price Ratio)`
*   **Tool:** You can use an online Uniswap V3 Tick Calculator for this. Search for one and ensure you input the correct decimals for both tokens (your DERC20 and the numeraire).
*   **Example (Price Ratio of `0.000277778`):** This gives a central tick of approximately `-81861` (assuming DERC20 has 18 decimals and the $0.02 numeraire also has 18 decimals for this calculation; adjust if numeraire decimals differ, e.g., 6 for USDC).

**5. Set Your Start and End Ticks: Tight vs. Wide Range for a New Token Launch**

Now, choose a `Start Tick` and `End Tick` that bracket your calculated central tick (e.g., `-81861`). This defines your initial price range for the sale. Remember, this Uniswap V3 range is temporary; after the sale and pool graduation, liquidity moves to a standard full-range Uniswap V2 pool.

*   **Tighter Range (e.g., Central Tick +/- a few hundred ticks; e.g., `Start: -82000`, `End: -81700` for our example):**
    *   **Pros:** Concentrates liquidity effectively. If the initial price you've set (derived from your "Target Market Cap" and the number of tokens for sale) aligns well with what early market participants are willing to pay, this provides lower slippage for those buyers and more apparent price stability *within* that range. This can make the sale more attractive.
    *   **Cons:** If market demand significantly deviates from your target, the price can quickly reach one end of your range. This might exhaust liquidity on one side, effectively pausing the LBP mechanism until the price comes back into range.
    *   **Consider if:** You have some conviction in your initial valuation and want to offer a smoother experience for early participants.

*   **Wider Range (e.g., Central Tick +/- a few thousand ticks; e.g., `Start: -90000`, `End: -75000` for our example):**
    *   **Pros:** Allows for more significant price discovery during the sale. The market has more room to establish a price without quickly hitting the boundaries of your concentrated liquidity. This is more forgiving if your initial price estimate is highly uncertain.
    *   **Cons:** Liquidity is spread thinner, leading to higher slippage for individual swaps within the range. The price might appear more volatile during the sale.
    *   **Consider if:** There's high uncertainty about the initial fair market price, or if the primary goal of the LBP is broader price discovery over initial price stability.

**General Guidance for New Tokens:** There's no single "right" answer. If very unsure, a moderately wider range might be safer for the LBP mechanism itself, allowing the market more room to find its footing. If you have a stronger basis for your target price, a moderately tighter range can improve the experience for early buyers.

**6. Number of Positions:**

The `Number of Positions` parameter (defaulting to 100 in the SDK's `DEFAULT_NUM_TICKS_PER_POSITION_WAD`) works with your chosen tick range. It determines how many discrete liquidity positions are created within that start/end tick range. More positions generally result in a smoother liquidity curve, meaning the price changes more gradually as tokens are bought or sold within your defined range. The default is often sufficient for most LBP-style sales.

**What about the other parameters?**

-   **Max Share to be Sold** and **Fee** are independent of the initial price calculation. They are important settings for managing your sale and pool but are not derived from the target market cap.

### Pool Graduation

### Integrator Fee

The Doppler protocol supports an integrator fee, which can be earned by the entity (e.g., a UI, a script, or a platform) that facilitates the creation of a new pool. You can read more about this in the [official Doppler documentation on Fees and Economics](https://docs.doppler.lol/how-it-works/fees-and-economics).

In this miniapp implementation:

*   **Default Behavior**: The integrator address is automatically set to the wallet address of the user deploying the pool. This is handled in the `src/pages/DeployDoppler.tsx` file where the `integrator` parameter is assigned the deployer's `account.address`.
*   **Customization**: If you wish to set a different integrator address (e.g., a dedicated treasury address for your platform), you would need to modify the `DeployDoppler.tsx` component. This would typically involve adding a new input field for the integrator address and updating the `handleDeploy` function to use this custom address instead of `account.address`.



The transition from a limited, concentrated liquidity sale to a full-range, decentralized pool is known as "graduation." This process is not automatic; it must be manually triggered.

Here’s how it works:

1.  **Manual Trigger**: The project owner (or an authorized address) must call the `migrate(assetAddress)` function on the `Airlock` contract that was created with the pool.
2.  **Migration Execution**: This function call invokes the `liquidityMigrator` contract, which handles the logic of converting the initial sale pool into a standard AMM pool.
3.  **Unlocking the Token**: The final step of the migration is the `liquidityMigrator` calling the `unlockPool()` function on your project's token contract (`DERC20`). This is a permanent, one-way action that finalizes the graduation.

The specific conditions for when to trigger graduation (e.g., after the sale is complete or a certain time has passed) are not enforced by the smart contracts. Project creators are responsible for monitoring their pool's progress and deciding when it is appropriate to initiate the migration.

## Tech Stack

- React 
- TypeScript
- Vite
- Tailwind CSS
- GraphQL
- Radix UI Components
- Wagmi
- Viem

## Prerequisites

- Node.js (LTS version recommended)
- Bun (for package management)
- Git

## Getting Started

1. Clone the repository:
```bash
git clone https://github.com/whetstoneresearch/doppler-v3-miniapp.git
cd doppler-v3-miniapp
```

2. Install dependencies:
```bash
bun install
```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Fill in the required environment variables:
     - `VITE_INDEXER_GRAPHQL`: Your GraphQL endpoint URL
   - Optionally, set the following environment variables:
     - `VITE_DEFAULT_CUSTOM_NUMERAIRE_ADDRESS`: If you want to pre-fill the custom numeraire address field on the pool deployment page, set this to a valid ERC20 token address (e.g., `0x123...`). Users can still override this in the UI.

4. Start the development server:
```bash
bun run dev
```

The application will be available at `http://localhost:5173`

### Using a Custom ERC20 Numeraire

When deploying a new Doppler pool via the UI (accessible from the homepage), you can input the contract address of a custom ERC20 token to be used as the numeraire for that pool. Ensure this token is deployed on the connected network. If you have set `VITE_DEFAULT_CUSTOM_NUMERAIRE_ADDRESS` in your `.env` file, this field will be pre-populated.

When swapping tokens involving a custom ERC20 numeraire, the application utilizes Permit2 for token approvals to enhance gas efficiency and user experience.

## Available Scripts
- `bun run dev` - Start the development server
- `bun run build` - Build the application for production
- `bun run preview` - Preview the production build locally
- `bun run lint` - Run the linter
- `bun run codegen` - Generate GraphQL types

## Important Notes

### Token Swaps with Custom Numeraires (Permit2)

When performing a swap that involves spending a custom ERC20 numeraire (or spending an asset from a pool where the numeraire is a custom ERC20 token you hold), you will encounter two (2) confirmation prompts in MetaMask:

1.  **Permit Signature:** The first prompt is an EIP-712 signature request (it will typically show "Sign typed data" or similar). This is an off-chain signature that grants the Doppler Universal Router permission to use your tokens via the Permit2 contract. *This step does not cost gas.*
2.  **Transaction Confirmation:** The second prompt is to confirm the actual swap transaction. This on-chain transaction executes the swap and *will incur gas fees.*

This two-step confirmation (off-chain signature + on-chain transaction) is standard and expected for gas-efficient approval mechanisms like Permit2.

## Project Structure

- `src/` - Source code directory
  - `components/` - Reusable UI components
  - `pages/` - Page components
  - `hooks/` - Custom React hooks
  - `utils/` - Utility functions
  - `types/` - TypeScript type definitions
  - `graphql/` - GraphQL queries and mutations

## License

[MIT](/LICENSE)