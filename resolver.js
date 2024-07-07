const { Web3 } = require('web3');

const ABI = [
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "agent",
				"type": "address"
			},
			{
				"internalType": "address",
				"name": "router",
				"type": "address"
			}
		],
		"stateMutability": "nonpayable",
		"type": "constructor"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "owner",
				"type": "address"
			}
		],
		"name": "OwnableInvalidOwner",
		"type": "error"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "account",
				"type": "address"
			}
		],
		"name": "OwnableUnauthorizedAccount",
		"type": "error"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "previousOwner",
				"type": "address"
			},
			{
				"indexed": true,
				"internalType": "address",
				"name": "newOwner",
				"type": "address"
			}
		],
		"name": "OwnershipTransferred",
		"type": "event"
	},
	{
		"inputs": [],
		"name": "renounceOwnership",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "agent",
				"type": "address"
			},
			{
				"internalType": "address",
				"name": "router",
				"type": "address"
			}
		],
		"name": "setAddresses",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "srcToken",
				"type": "address"
			},
			{
				"internalType": "address",
				"name": "dstToken",
				"type": "address"
			},
			{
				"internalType": "uint24",
				"name": "poolFee",
				"type": "uint24"
			},
			{
				"internalType": "uint256",
				"name": "amt",
				"type": "uint256"
			}
		],
		"name": "swap",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "newOwner",
				"type": "address"
			}
		],
		"name": "transferOwnership",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "AGENT",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "owner",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "ROUTER",
		"outputs": [
			{
				"internalType": "contract ISwapRouter",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	}
];

const baseUrl = 'http://model-v2-api-471546444.us-east-1.elb.amazonaws.com:8001/api/v1';

async function checkHealth() {
    try {
        const response = await fetch(`${baseUrl}/health`);
        const data = await response.json();
        return data.status === 'ok';
    } catch (error) {
        console.error('Error:', error);
        return false;
    }
}

async function getTrendAcc() {
    try {
        const response = await fetch(`${baseUrl}/model`);
        const data = await response.json();
        return data[0].test_trend_acc;
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}

async function getPriceAndPred(token) {
    token = token.toLowerCase();
    if (token === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') {
        return [1, 0];
    }

    try {
        const response = await fetch(`${baseUrl}/predict/${token}`);
        const data = await response.json();
        return [data[0].price, data[0].prediction];
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}

function encode(swapTokenSrc, swapTokenDst, fee, swapAmt) {
    const web3 = new Web3();
    const contract = new web3.eth.Contract(ABI);
    
    const swapTokenSrcChecksum = web3.utils.toChecksumAddress(swapTokenSrc);
    const swapTokenDstChecksum = web3.utils.toChecksumAddress(swapTokenDst);
    
    const encodedABI = contract.methods.swap(swapTokenSrcChecksum, swapTokenDstChecksum, fee, swapAmt.toString()).encodeABI();
    
    return encodedABI;
}

async function internalLogic(tokenSrc, tokenDst, threshLow, threshHi, threshRel, amtUSD, accthresh, fee) {
    if (!(await checkHealth())) {
        return [1, []];
    }

    const trendAcc = await getTrendAcc();
    if (trendAcc < accthresh) {
        return [2, []];
    }

    const [priceSrc, predSrc] = await getPriceAndPred(tokenSrc);
    const [priceDst, predDst] = await getPriceAndPred(tokenDst);

    if (priceSrc === null || priceDst === null || predSrc === null || predDst === null) {
        return [1, []];
    }

    if (Math.abs(predSrc / priceSrc) < threshRel) {
        return [3, []];
    }

    if (predSrc > 0) {
        if (priceSrc + predSrc > threshLow) {
            const dstToExpend = amtUSD / BigInt(priceDst + predDst);
            return [0, [tokenDst, tokenSrc, fee, dstToExpend * BigInt(1e18)]];
        }
    }

    if (predSrc < 0) {
        if (BigInt(priceSrc + predSrc) < threshHi) {
            const srcToExpend = amtUSD / Bigint(priceSrc + predSrc);
            return [0, [tokenSrc, tokenDst, fee, srcToExpend * BigInt(1e18)]];
        }
    }

    return [4, []];
}

async function resolver(tokenSrc, tokenDst, threshLow, threshHi, threshRel, amtUSD, accthresh, fee, waitTime) {
    setInterval(async () => {
        const [ok, args] = await internalLogic(tokenSrc, tokenDst, threshLow, threshHi, threshRel, amtUSD, accthresh, fee);
        if (ok === 0) {
            console.log('Initiating swap');
            console.log(`[RESULT_TX_DATA]: ${encode(...args)}`);
        }
    }, waitTime * 1000);
}


resolver(
    '0x0ab87046fbb341d058f17cbc4c1133f25a20a52f', 
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
     0, 
     BigInt('1000000000000000000000'), 
     0, 
     BigInt(1), 
     0, 
     3000, 
     60,
);