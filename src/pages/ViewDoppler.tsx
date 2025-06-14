import { Navigate, useParams } from "react-router-dom";
import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { Address, formatEther, Hex, parseEther, zeroAddress } from "viem";
import {
  PermitSingle,
  SwapRouter02Encoder,
  CommandBuilder,
} from "doppler-router";
import { universalRouterAbi } from "../abis/UniversalRouterABI";
import { ReadQuoter } from "doppler-v3-sdk";
import { getDrift } from "@/utils/drift";
import { useAsset, usePositions } from "@/services/indexer";
import {
  Button,
  Input,
  Card,
  Separator,
  Skeleton,
  Label,
} from "../components/ui";
import LiquidityChart from "../components/LiquidityChart";
import TokenName from "../components/TokenName";
import { addresses } from "../addresses";

// Define a reusable Token type
type Token = {
  address: string;
  name?: string;
  symbol?: string;
};

// Define the WETH address for the target chain (e.g., Base, Optimism)
// IMPORTANT: This address might need to be configured based on the actual target chain
const CHAIN_WETH_ADDRESS: Address = "0x4200000000000000000000000000000000000006";


function ViewDoppler() {
  // Hooks and state initialization
  const { id } = useParams();
  const account = useAccount();
  const { data: walletClient } = useWalletClient(account);
  const publicClient = usePublicClient();
  const { universalRouter, quoterV2 } = addresses;
  const drift = getDrift(walletClient);
  const quoter = new ReadQuoter(quoterV2, zeroAddress, drift);

  // Validation and data fetching
  const isValidAddress = id?.match(/^0x[a-fA-F0-9]{40}$/);
  if (!isValidAddress || !id) return <Navigate to="/" />;

  const { data: assetData, isLoading: isAssetLoading } = useAsset(id);
  const { data: positions, isLoading: isPositionsLoading } = usePositions(
    assetData?.asset?.pool?.address
  );

  const isLoading = isAssetLoading || isPositionsLoading;
  const { baseToken, quoteToken } = assetData?.asset?.pool || {};
  const positionItems = positions?.positions?.items || [];

  const [swapState, setSwapState] = useState({
    numeraireAmount: "",
    assetAmount: "",
    activeField: "numeraire" as "numeraire" | "asset",
  });

  const handleSwap = async () => {
    if (!account.address || !baseToken || !quoteToken || !walletClient || !publicClient) return;

    const block = await publicClient.getBlock();
    const { activeField, numeraireAmount, assetAmount } = swapState;
    const isSellingNumeraire = activeField === "numeraire";
    const amountToSwap = parseEther(
      isSellingNumeraire ? numeraireAmount : assetAmount
    );

    let permit: PermitSingle | undefined;
    let signature: Hex | undefined;

    // A permit is only required if we are selling a non-native ERC20 token.
    const needsPermit = !isSellingNumeraire || (isSellingNumeraire && quoteToken.address !== CHAIN_WETH_ADDRESS);

    if (needsPermit) {
      const permit2Abi = [
        {
          inputs: [
            { name: "user", type: "address", internalType: "address" },
            { name: "token", type: "address", internalType: "address" },
            { name: "spender", type: "address", internalType: "address" },
          ],
          name: "allowance",
          outputs: [
            { name: "amount", type: "uint160", internalType: "uint160" },
            { name: "expiration", type: "uint48", internalType: "uint48" },
            { name: "nonce", type: "uint48", internalType: "uint48" },
          ],
          stateMutability: "view",
          type: "function",
        },
      ] as const;

      const tokenToPermit = (isSellingNumeraire ? quoteToken.address : baseToken.address) as Address;

      const allowanceData = await publicClient.readContract({
        address: addresses.permit2,
        abi: permit2Abi,
        functionName: "allowance",
        args: [account.address, tokenToPermit, addresses.universalRouter],
      });
      const fetchedNonce = BigInt(allowanceData[2]);

      permit = createPermitData({
        isSellingNumeraire,
        amount: amountToSwap,
        blockTimestamp: block.timestamp,
        baseTokenAddress: baseToken.address as Address,
        quoteTokenAddress: quoteToken.address as Address,
        nonce: fetchedNonce,
      });

      console.log("Permit object for signing:", JSON.stringify(permit, (_key, value) => typeof value === 'bigint' ? value.toString() : value));

      const domain = {
        name: "Permit2",
        chainId: publicClient.chain.id,
        verifyingContract: addresses.permit2,
      } as const;

      const types = {
        PermitDetails: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' },
          { name: 'nonce', type: 'uint48' },
        ],
        PermitSingle: [
          { name: 'details', type: 'PermitDetails' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      } as const;

      try {
        // The message for signing must EXACTLY match the EIP-712 type structure.
        const message = {
          details: {
            token: permit.details.token,
            amount: permit.details.amount,
            expiration: Number(permit.details.expiration),
            nonce: Number(permit.details.nonce),
          },
          spender: permit.spender,
          sigDeadline: permit.sigDeadline,
        };

        signature = await walletClient.signTypedData({
          account: account.address,
          domain,
          types,
          primaryType: 'PermitSingle',
          message,
        });
        console.log("Manual EIP-712 Signature:", signature);
      } catch (e) {
        console.error("Error during manual EIP-712 signing:", e);
        return;
      }

      if (!signature) {
        console.error("Manual signature is undefined after signing process. Cannot proceed.");
        return;
      }
    }

    console.log("Permit details (from createPermitData):", permit);
    console.log("Signature to be used for swap:", signature);

    const [commands, inputs] = buildSwapCommands({
      isSellingNumeraire,
      amount: amountToSwap,
      permit,
      signature,
      baseTokenAddress: baseToken.address as Address,
      quoteTokenAddress: quoteToken.address as Address,
      account: account.address,
    });

    const { request } = await publicClient.simulateContract({
      address: universalRouter,
      abi: universalRouterAbi,
      functionName: "execute",
      args: [commands, inputs],
      account: walletClient.account,
      value: (isSellingNumeraire && quoteToken.address === CHAIN_WETH_ADDRESS) ? amountToSwap : 0n,
    });

    const txHash = await walletClient.writeContract(request);
    return await publicClient.waitForTransactionReceipt({ hash: txHash });
  };

  const handleAmountChange = async (
    value: string,
    field: "numeraire" | "asset"
  ) => {
    // Update the input field's value and the active field in one go
    setSwapState((prev) => ({
      ...prev,
      [field === "numeraire" ? "numeraireAmount" : "assetAmount"]: value,
      activeField: field, // Ensure activeField is updated
    }));

    // Basic validation: if value is empty, not a valid number, or negative string
    if (
      !value.trim() || // Handles empty or whitespace-only string
      isNaN(parseFloat(value)) || // Handles non-numeric strings like "-"
      parseFloat(value) < 0 // Handles negative numbers like "-1"
    ) {
      // Clear the *other* field if input is invalid/cleared
      setSwapState((prev) => ({
        ...prev,
        [field === "numeraire" ? "assetAmount" : "numeraireAmount"]: "",
      }));
      return;
    }

    // Ensure all required data for quoting is available
    // These should be in scope from hooks like useState, usePublicClient, useDopplerSDK
    if (!publicClient || !baseToken || !quoteToken || !quoter) {
      console.warn("Quoting prerequisites not met:", { publicClient, baseToken, quoteToken, quoter });
      setSwapState((prev) => ({
        ...prev,
        [field === "numeraire" ? "assetAmount" : "numeraireAmount"]: "",
      }));
      return;
    }

    try {
      // value should be a non-negative number string at this point
      const inputValueInWei = parseEther(value);

      // If parsed value is zero (e.g., "0" or "0.0"), clear the other field and return
      if (inputValueInWei === 0n) {
        setSwapState((prev) => ({
          ...prev,
          [field === "numeraire" ? "assetAmount" : "numeraireAmount"]: "",
        }));
        return;
      }

      const tokenIn =
        field === "numeraire" ? quoteToken.address : baseToken.address;
      const tokenOut =
        field === "numeraire" ? baseToken.address : quoteToken.address;

      const { amountOut } = await quoter.quoteExactInputV3({
        tokenIn: tokenIn as Address,
        tokenOut: tokenOut as Address,
        amountIn: inputValueInWei,
        fee: 10000, 
        sqrtPriceLimitX96: 0n,
      });

      const formattedAmount = Number(formatEther(amountOut)).toFixed(4);
      setSwapState((prev) => ({
        ...prev,
        [field === "numeraire" ? "assetAmount" : "numeraireAmount"]:
          formattedAmount,
      }));
    } catch (error) {
      console.error(`Error in handleAmountChange while quoting for ${field} field:`, error);
      // Clear the *other* field on error too, as the quote failed.
      setSwapState((prev) => ({
        ...prev,
        [field === "numeraire" ? "assetAmount" : "numeraireAmount"]: "",
      }));
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 text-lg">
      <header className="flex items-center flex-start">
        <TokenName
          name={quoteToken?.name ?? ""}
          symbol={quoteToken?.symbol ?? ""}
        />{" "}
        /{" "}
        <TokenName
          name={baseToken?.name ?? ""}
          symbol={baseToken?.symbol ?? ""}
        />
      </header>

      <Separator />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      ) : (
        <>
          <LiquidityInfoCard
            liquidity={assetData?.asset?.pool?.liquidity}
            price={assetData?.asset?.pool?.price}
            currentTick={assetData?.asset?.pool?.tick}
            baseToken={baseToken ?? undefined}
            quoteToken={quoteToken ?? undefined}
            positions={positionItems}
          />

          <SwapCard
            baseToken={baseToken ?? undefined}
            quoteToken={quoteToken ?? undefined}
            swapState={swapState}
            onAmountChange={handleAmountChange}
            onSwap={handleSwap}
            isLoading={isLoading}
          />
        </>
      )}
    </div>
  );
}

function createPermitData({
  isSellingNumeraire,
  amount,
  blockTimestamp,
  baseTokenAddress,
  quoteTokenAddress,
  nonce, // Added nonce parameter
}: {
  isSellingNumeraire: boolean;
  amount: bigint;
  blockTimestamp: bigint;
  baseTokenAddress: Address;
  quoteTokenAddress: Address;
  nonce: bigint; // Added nonce type
}): PermitSingle {
  const tokenToPermit = isSellingNumeraire ? quoteTokenAddress : baseTokenAddress;
  // Standardize expiration to 30 minutes for the allowance itself
  const expirationTime = blockTimestamp + 1800n; // 30 minutes from current block timestamp

  return {
    details: {
      token: tokenToPermit,
      amount: amount, // Max amount to approve
      expiration: expirationTime, 
      nonce: nonce, // Use the passed nonce
    },
    spender: addresses.universalRouter,
    sigDeadline: blockTimestamp + 3600n, // Signature itself valid for 1 hour
  };
}

function buildSwapCommands({
  isSellingNumeraire,
  amount,
  permit,
  signature,
  baseTokenAddress,
  quoteTokenAddress,
  account,
}: {
  isSellingNumeraire: boolean;
  amount: bigint;
  permit?: PermitSingle;
  signature?: Hex;
  baseTokenAddress: Address;
  quoteTokenAddress: Address;
  account: Address;
}) {
  const isToken0 = baseTokenAddress < quoteTokenAddress;
  const zeroForOne = isSellingNumeraire ? isToken0 : !isToken0;
  const pathArray = zeroForOne
    ? [baseTokenAddress, quoteTokenAddress]
    : [quoteTokenAddress, baseTokenAddress];


  const path = new SwapRouter02Encoder().encodePath(pathArray, 10000);

  const builder = new CommandBuilder();
  // If selling ASSET (baseToken) for NUMERAIRE (quoteToken)
  if (!isSellingNumeraire && permit && signature) {
    // Permit is for the baseToken (asset)
    builder
      .addPermit2Permit(permit, signature)
      .addV3SwapExactIn(account, amount, 0n, path, true); // true: Payer is Permit2
  } else if (isSellingNumeraire && quoteTokenAddress !== CHAIN_WETH_ADDRESS && permit && signature) {
    // Selling custom ERC20 NUMERAIRE (quoteToken) for ASSET (baseToken)
    // Permit is for the quoteToken (custom numeraire)
    builder
      .addPermit2Permit(permit, signature)
      .addV3SwapExactIn(account, amount, 0n, path, true); // true: Payer is Permit2
  } else if (isSellingNumeraire && quoteTokenAddress === CHAIN_WETH_ADDRESS) {
    // Selling WETH NUMERAIRE (quoteToken) for ASSET (baseToken)
    // No permit needed, uses msg.value and wrapEth
    builder
      .addWrapEth(addresses.universalRouter, amount)
      .addV3SwapExactIn(account, amount, 0n, path, false); // false: Payer is msg.sender
  } else {
    // This case should ideally not be reached if logic is correct
    // Or could be a scenario where selling numeraire (WETH) but permit was somehow generated (error)
    // For safety, or if other non-permit2 paths for ERC20s were to be added:
    // Fallback or error, but current logic implies WETH path if no permit for numeraire
    console.warn("buildSwapCommands: Unhandled swap case or missing permit for non-WETH numeraire sale.");
    // Defaulting to WETH path if isSellingNumeraire is true and no specific permit logic for custom ERC20 hit
    // This might occur if quoteTokenAddress !== CHAIN_WETH_ADDRESS but permit/signature were not generated
    // which would be an issue in handleSwap. The explicit checks should prevent this.
    builder
      .addWrapEth(addresses.universalRouter, amount)
      .addV3SwapExactIn(account, amount, 0n, path, false);
  }

  console.log("builder", builder);

  return builder.build();
}

// Extracted UI components
const LiquidityInfoCard = ({
  liquidity,
  price,
  currentTick,
  baseToken,
  quoteToken,
  positions,
}: {
  liquidity?: bigint;
  price?: bigint;
  currentTick?: number;
  baseToken?: Token;
  quoteToken?: Token;
  positions: any[];
}) => (
  <Card className="p-6 space-y-4">
    <div className="grid grid-cols-2 gap-4">
      <StatItem label="Total Liquidity" value={liquidity?.toString()} />
      <StatItem
        label="Current Price"
        value={`1 ${quoteToken?.symbol} = ${price} ${baseToken?.symbol}`}
      />
    </div>
    <LiquidityChart positions={positions} currentTick={currentTick ?? 0} />
  </Card>
);

const StatItem = ({ label, value }: { label: string; value?: string }) => (
  <div className="space-y-1">
    <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
    <p className="text-xl font-semibold">{value || "-"}</p>
  </div>
);

const SwapCard = ({
  baseToken,
  quoteToken,
  swapState,
  onAmountChange,
  onSwap,
  isLoading,
}: {
  baseToken?: Token;
  quoteToken?: Token;
  swapState: {
    numeraireAmount: string;
    assetAmount: string;
    activeField: string;
  };
  onAmountChange: (value: string, field: "numeraire" | "asset") => void;
  onSwap: () => void;
  isLoading: boolean;
}) => (
  <Card className="p-6 space-y-6">
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Swap Tokens</h3>
      <Separator />

      <SwapInput
        label={`${quoteToken?.name} (${quoteToken?.symbol})`}
        value={swapState.numeraireAmount}
        onChange={(value) => onAmountChange(value, "numeraire")}
        disabled={isLoading}
      />

      <div className="relative">
        <Separator className="absolute top-1/2 w-full" />
        <div className="relative flex justify-center">
          <span className="bg-background px-2 text-muted-foreground">↓</span>
        </div>
      </div>

      <SwapInput
        label={`${baseToken?.name} (${baseToken?.symbol})`}
        value={swapState.assetAmount}
        onChange={(value) => onAmountChange(value, "asset")}
        disabled={isLoading}
      />

      <Button
        className="w-full"
        disabled={!swapState.numeraireAmount && !swapState.assetAmount}
        onClick={onSwap}
      >
        {swapState.activeField === "numeraire"
          ? `Buy ${baseToken?.symbol} with ${quoteToken?.symbol}`
          : `Buy ${quoteToken?.symbol} with ${baseToken?.symbol}`}
      </Button>
    </div>
  </Card>
);

const SwapInput = ({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => (
  <div className="space-y-2">
    <Label htmlFor={label}>{label}</Label>
    <Input
      type="number"
      id={label}
      placeholder="0.0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      step="any"
    />
  </div>
);

export default ViewDoppler;
