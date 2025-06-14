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
- **Vesting Configuration:**
  - **Yearly Mint Rate:** `2%`
  - **Vesting Duration:** `1 year`
  - **Pre-Mint for Creator:** `9,000,000` tokens (0.9% of total supply)
- **Governance Configuration:**
  - **Initial Voting Delay:** `2 days`
  - **Initial Voting Period:** `14 days`
  - **Initial Proposal Threshold:** `0`

### Calculating Start and End Ticks

The start and end ticks for a new pool are determined by the desired price range for the token during the liquidity bootstrapping phase. The market capitalization of the token is a key factor in this calculation. As the core team explained:

> Market cap is simply the unit price of the token (implied by the current `sqrtPrice` on Uniswap) multiplied by the `totalSupply`. To determine the correct ticks for your desired price range, you can use the `TickMath.sqrtPriceAtTick(tick)` function to convert a tick to a price.

To simplify this process, you can use the [Token Launch Market Cap Calculator](https://ohara.ai/mini-apps/4ea7712e-6f72-4399-8863-ae139c306a47) to determine the appropriate ticks for your target market cap.

**Example:**

### Calculating Ticks from a Target Market Cap

Setting the right `Start Tick` and `End Tick` is crucial for establishing your token's initial price and liquidity depth. Instead of picking a price directly, it's often more intuitive to work backward from a desired initial **market capitalization** for the tokens being sold.

Here’s a step-by-step guide:

1.  **Define Your Goal:**
    *   **Target Market Cap:** The desired initial valuation of the tokens you are putting up for sale. (e.g., `$5,000`).
    *   **Number of Tokens to Sell:** The total number of your tokens you will add to the pool. The default is `900,000,000`.
    *   **Numeraire Token Price:** The stable price of your chosen numeraire token (e.g., a custom stablecoin at `$0.02` or USDC at `$1.00`).

2.  **Calculate the Target Initial Price:**
    Determine the price per token needed to achieve your target market cap.
    *   **Formula:** `Initial Token Price = Target Market Cap / Number of Tokens to Sell`
    *   **Example:** `$5,000 / 900,000,000 tokens = $0.00000556` per token.

3.  **Calculate the Price Ratio:**
    The price must be expressed as a ratio relative to the numeraire.
    *   **Formula:** `Price Ratio = Initial Token Price / Numeraire Token Price`
    *   **Example:** `$0.00000556 / $0.02 = 0.000278`

4.  **Convert Price Ratio to a Tick:**
    This ratio corresponds to a specific price tick in the Uniswap V3 system. This tick will be the center of your liquidity range.
    *   **Formula:** `tick = log(price_ratio) / log(1.0001)`
    *   **Tool:** You can use an online Uniswap V3 Tick Calculator for this.
    *   **Example:** A price ratio of `0.000278` gives a central tick of approximately `-81861`.

5.  **Set Your Start and End Ticks:**
    Choose a `Start Tick` and `End Tick` that bracket your central tick. This defines your initial price range.
    *   A **tighter range** (e.g., `Start: -82000`, `End: -81700`) concentrates liquidity, offering a more stable price for initial swaps but risking running out of liquidity if the price moves significantly.
    *   A **wider range** (e.g., `Start: -90000`, `End: -75000`) spreads liquidity out, accommodating more price volatility but with higher price impact for each swap.

The `Number of Positions` parameter works with your tick range. It determines how many discrete liquidity positions are created within that range. More positions result in a smoother liquidity curve.

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