import {ChainAdapterFactory} from '../core/adapters/factory.ts'
import {providerErrors} from '../core/errors.ts'
import {readSwitchGroupId, selectGroupNetwork} from '../core/networks/groupSelection.ts'
import {PermissionController} from '../core/permissions/permissionController.ts'
import {readProviderTransaction, readTransactionHash,} from '../core/transaction/providerTransaction.ts'
import {
	type FiscoTransactionNetworkMetadata,
	readFiscoBlockNumber,
	readFiscoTransactionNetworkMetadata,
} from '../core/transaction/fiscoNetworkMetadata.ts'
import {
	createFiscoNonce,
	type FiscoV0TransactionData,
	hexToBytes,
	type SignedFiscoTransaction,
} from '../core/transaction/fiscoV0Transaction.ts'
import {
	type SignedWeb3Transaction,
	type Web3TransactionData,
} from '../core/transaction/web3Transaction.ts'
import {readSwitchAccountAddress} from '../core/wallet/accountSelection.ts'
import type {
	SelectAccountInput,
	WalletRepository,
	WalletSummary,
} from '../core/wallet/types.ts'
import type {
	CryptoKind,
	NetworkConfig,
	ProviderRequest,
	ProviderRpcMode,
} from '../shared/types.ts'
import type {TransactionActivity, TransactionWatch,} from '../shared/walletHomeMessages.ts'
import {
	TRANSACTION_MAX_ATTEMPTS,
	TRANSACTION_MONITOR_TIMEOUT_MS,
	TRANSACTION_POLL_INTERVAL_MS,
} from './transactionMonitor.ts'
import type {ApprovalGateway} from './approvalController.ts'
import type {
	ConnectApprovalData,
	SwitchApprovalData,
	TransactionApprovalData,
} from '../shared/approvalMessages.ts'
import type {ProviderStateBroadcaster} from './providerStateBroadcast.ts'

interface ProviderNetworkStore {
	getAll(): Promise<NetworkConfig[]>

	getActive(): Promise<NetworkConfig | undefined>

	setActive(network: NetworkConfig): Promise<void>
}

interface ProviderWalletBackend extends Pick<WalletRepository, 'getSummary'> {
	selectAccount(input: SelectAccountInput): Promise<WalletSummary>

	signFiscoV0Transaction(
		from: string,
		data: FiscoV0TransactionData,
		expectedCrypto: CryptoKind,
	): Promise<SignedFiscoTransaction>

	signWeb3Transaction(
		from: string,
		data: Web3TransactionData,
	): Promise<SignedWeb3Transaction>
}

interface ActivityStore {
	add(activity: TransactionActivity): Promise<void>
}

interface TransactionTracker {
	readonly maxAttempts?: number
	readonly initialPollDelayMs?: number
	readonly pollIntervalMs?: number

	track(activity: TransactionActivity, watch: TransactionWatch): Promise<void>
}

const BLOCK_LIMIT_RANGE = 500n

const PUBLIC_METHODS = new Set([
	'eth_chainId',
	'net_version',
	'eth_blockNumber',
	'eth_call',
	'eth_estimateGas',
	'eth_gasPrice',
	'eth_getBalance',
	'eth_getBlockByHash',
	'eth_getBlockByNumber',
	'eth_getCode',
	'eth_getLogs',
	'eth_getStorageAt',
	'eth_getTransactionByHash',
	'eth_getTransactionCount',
	'eth_getTransactionReceipt',
])

const NATIVE_READ_METHODS = new Set([
	'fisco_getBlockNumber',
	'fisco_getBlockByNumber',
	'fisco_getBlockByHash',
	'fisco_getTransaction',
	'fisco_getTransactionReceipt',
	'fisco_getSystemConfigByKey',
	'fisco_getTotalTransactionCount',
	'fisco_call',
])

export class RequestRouter {
	constructor(
		private readonly permissions: PermissionController,
		private readonly wallets: ProviderWalletBackend,
		private readonly networks: ProviderNetworkStore,
		private readonly adapters = new ChainAdapterFactory(),
		private readonly activities?: ActivityStore,
		private readonly approvals?: ApprovalGateway,
		private readonly transactionTracker?: TransactionTracker,
		private readonly broadcastProviderState: ProviderStateBroadcaster = () => undefined,
	) {
	}

	async request(origin: string, request: ProviderRequest): Promise<unknown> {
		if (request.method === 'eth_accounts') return this.accountsFor(origin)
		if (request.method === 'eth_requestAccounts') return this.requestAccounts(origin)
		if (request.method === 'wallet_switchAccount') {
			return this.switchAccount(origin, request.params)
		}
		if (request.method === 'wallet_getGroup') return this.getGroup()
		if (request.method === 'wallet_getMode') return this.getMode()
		if (request.method === 'wallet_getCrypto') return this.getCrypto()
		if (request.method === 'wallet_getCompatibilityVersion') {
			return this.getCompatibilityVersion()
		}
		if (request.method === 'wallet_switchGroup') return this.switchGroup(origin, request.params)
		if (request.method === 'wallet_switchEthereumChain') {
			return this.switchChain(origin, request.params)
		}
		if (request.method === 'eth_sendTransaction') {
			return this.sendTransaction(origin, request.params)
		}

		if (!PUBLIC_METHODS.has(request.method) && !NATIVE_READ_METHODS.has(request.method)) {
			throw providerErrors.unsupported(request.method)
		}

		const network = await this.networks.getActive()
		if (!network) throw providerErrors.disconnected('No active FISCO BCOS network is configured')
		if (request.method === 'eth_chainId') return toChainId(network.chainId)
		if (request.method === 'net_version') return String(network.chainId)
		const adapter = await this.adapters.create(network)
		return adapter.request(request)
	}

	private async accountsFor(origin: string) {
		const [authorized, summary, network] = await Promise.all([
			this.permissions.accountsFor(origin),
			this.wallets.getSummary(),
			this.networks.getActive(),
		])
		if (!summary || !network) return []
		const available = new Set(
			summary.accounts.map((account) => account.addresses[network.crypto].toLowerCase()),
		)
		const exposed = authorized.filter((address) => available.has(address.toLowerCase()))
		const activeAddress = summary.accounts.find(
			(account) => account.index === summary.activeAccountIndex,
		)?.addresses[network.crypto]
		if (!activeAddress) return exposed
		const activePosition = exposed.findIndex(
			(address) => address.toLowerCase() === activeAddress.toLowerCase(),
		)
		if (activePosition <= 0) return exposed
		return [
			exposed[activePosition]!,
			...exposed.filter((_, index) => index !== activePosition),
		]
	}

	private async requestAccounts(origin: string) {
		const authorized = await this.accountsFor(origin)
		if (authorized.length) return authorized

		const [summary, network] = await Promise.all([
			this.wallets.getSummary(),
			this.networks.getActive(),
		])
		if (!summary) throw providerErrors.disconnected('Wallet is not initialized')
		if (!network) throw providerErrors.disconnected('No active FISCO BCOS group is configured')
		const approval: ConnectApprovalData = {
			kind: 'connect',
			origin,
			network: this.approvalNetwork(network),
			accounts: summary.accounts.map((account) => ({
				index: account.index,
				name: account.name,
				remark: account.remark,
				address: account.addresses[network.crypto],
			})),
		}
		if (!approval.accounts.length) {
			throw providerErrors.disconnected('The wallet has no accounts available')
		}
		if (!this.approvals) {
			throw providerErrors.disconnected('Wallet approval service is unavailable')
		}
		const selected = await this.approvals.approveConnect(approval)
		const unique = [...new Set(selected)]
		if (!unique.length) throw providerErrors.userRejected()
		if (
			unique.length !== selected.length ||
			unique.some((index) => !Number.isInteger(index) || !approval.accounts.some((a) => a.index === index))
		) {
			throw providerErrors.unauthorized()
		}

		const [currentSummary, currentNetwork] = await Promise.all([
			this.wallets.getSummary(),
			this.networks.getActive(),
		])
		if (!currentSummary || !currentNetwork || !this.sameNetwork(network, currentNetwork)) {
			throw providerErrors.disconnected('Wallet network changed while connection approval was open')
		}
		const addresses = unique.map((index) => {
			const initial = approval.accounts.find((account) => account.index === index)!
			const current = currentSummary.accounts.find((account) => account.index === index)
			if (
				!current ||
				current.addresses[currentNetwork.crypto].toLowerCase() !== initial.address.toLowerCase()
			) {
				throw providerErrors.disconnected('Wallet accounts changed while connection approval was open')
			}
			return current.addresses[currentNetwork.crypto]
		})
		await this.permissions.grant(origin, addresses)
		return addresses
	}

	private async getGroup(): Promise<string> {
		const network = await this.networks.getActive()
		if (!network) throw providerErrors.disconnected('No active FISCO BCOS group is configured')
		if (!network.groupId) throw providerErrors.unsupported('wallet_getGroup on a Web3 network')
		return network.groupId
	}

	private async getMode(): Promise<ProviderRpcMode> {
		const network = await this.networks.getActive()
		if (!network) throw providerErrors.disconnected('No active network is configured')
		if (network.mode === 'web3') return 'web3'
		if (network.mode === 'legacy') return 'native'
		throw providerErrors.disconnected(`Unsupported RPC mode: ${String(network.mode)}`)
	}

	private async switchAccount(
		origin: string,
		params: ProviderRequest['params'],
	): Promise<null> {
		const requestedAddress = readSwitchAccountAddress(params)
		const [authorized, summary, network] = await Promise.all([
			this.permissions.accountsFor(origin),
			this.wallets.getSummary(),
			this.networks.getActive(),
		])
		if (!summary) throw providerErrors.disconnected('Wallet is not initialized')
		if (!network) {
			throw providerErrors.disconnected('No active FISCO BCOS group is configured')
		}
		const normalized = requestedAddress.toLowerCase()
		if (!authorized.some((address) => address.toLowerCase() === normalized)) {
			throw providerErrors.unauthorized()
		}
		const account = summary.accounts.find(
			(candidate) => candidate.addresses[network.crypto].toLowerCase() === normalized,
		)
		if (!account) throw providerErrors.unauthorized()
		await this.wallets.selectAccount({index: account.index})
		this.broadcastProviderState(['accounts'])
		return null
	}

	private async getCrypto(): Promise<NetworkConfig['crypto']> {
		const network = await this.networks.getActive()
		if (!network) throw providerErrors.disconnected('No active FISCO BCOS network is configured')
		return network.crypto
	}

	private async getCompatibilityVersion(): Promise<string> {
		const network = await this.requireActiveNetwork()
		const adapter = await this.adapters.create(network)
		return (await this.getTransactionNetworkMetadata(adapter)).compatibilityVersionText
	}

	private async sendTransaction(
		origin: string,
		params: ProviderRequest['params'],
		trustedWalletRequest = false,
	): Promise<`0x${string}`> {
		const transaction = readProviderTransaction(params)
		const authorized = trustedWalletRequest ? [transaction.from] : await this.accountsFor(origin)
		if (!authorized.some((address) => address.toLowerCase() === transaction.from.toLowerCase())) {
			throw providerErrors.unauthorized()
		}

		const network = await this.requireActiveNetwork()
		const adapter = await this.adapters.create(network)
		if (adapter.mode === 'web3') {
			return this.sendWeb3Transaction(origin, transaction, network, adapter)
		}
		const metadata = await this.getTransactionNetworkMetadata(adapter)
		this.assertTransactionNetwork(network, metadata)
		this.assertV0ProviderFields(transaction)

		const summary = await this.wallets.getSummary()
		const account = summary?.accounts.find(
			(candidate) =>
				candidate.addresses[network.crypto].toLowerCase() === transaction.from.toLowerCase(),
		)
		const data = transaction.data ?? '0x'
		const approval: TransactionApprovalData = {
			kind: 'transaction',
			origin,
			network: {
				...this.approvalNetwork(network),
				metadataChainId: metadata.chainID,
			},
			...(account ? {account: {index: account.index, name: account.name}} : {}),
			from: transaction.from,
			...(transaction.to ? {to: transaction.to} : {}),
			value: transaction.value ?? '0x0',
			data,
			dataBytes: (data.length - 2) / 2,
			...(data.length >= 10 ? {selector: data.slice(0, 10) as `0x${string}`} : {}),
		}
		if (!this.approvals) {
			throw providerErrors.disconnected('Wallet approval service is unavailable')
		}
		await this.approvals.approveTransaction(approval)
		const [currentNetwork, currentMetadata, blockNumberValue] = await Promise.all([
			this.networks.getActive(),
			this.getTransactionNetworkMetadata(adapter),
			adapter.request({method: 'fisco_getBlockNumber', params: []}),
		])
		if (!currentNetwork || !this.sameNetwork(network, currentNetwork)) {
			throw providerErrors.disconnected('Wallet network changed while transaction approval was open')
		}
		if (!this.sameTransactionMetadata(metadata, currentMetadata)) {
			throw providerErrors.disconnected(
				'FISCO group metadata changed while transaction approval was open',
			)
		}
		const blockNumber = readFiscoBlockNumber(blockNumberValue)
		const blockLimit = blockNumber + BLOCK_LIMIT_RANGE
		const signed = await this.wallets.signFiscoV0Transaction(
			transaction.from,
			{
				version: 0,
				chainID: metadata.chainID,
				groupID: metadata.groupID,
				blockLimit,
				nonce: createFiscoNonce(),
				to: transaction.to ?? '',
				input: hexToBytes(transaction.data ?? '0x'),
				abi: '',
			},
			metadata.smCryptoType ? 'gm' : 'standard',
		)
		const result = await adapter.request({
			method: 'eth_sendRawTransaction',
			params: [signed.rawTransaction, false],
		})
		const returnedHash = readTransactionHash(result)
		if (returnedHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
			throw new Error('RPC returned a transaction hash that does not match the signed transaction')
		}
		await this.recordSubmittedTransaction(
			origin,
			transaction,
			network,
			returnedHash,
			metadata.groupID,
			blockLimit,
		)
		return returnedHash
	}

	async sendWalletTransaction(params: ProviderRequest['params']): Promise<`0x${string}`> {
		return this.sendTransaction('FISCO BCOS Wallet', params, true)
	}

	private async sendWeb3Transaction(
		origin: string,
		transaction: ReturnType<typeof readProviderTransaction>,
		network: NetworkConfig,
		adapter: Awaited<ReturnType<ChainAdapterFactory['create']>>,
	): Promise<`0x${string}`> {
		if (network.crypto !== 'standard') {
			throw providerErrors.unsupported('eth_sendTransaction on a GM Web3 network')
		}
		if (
			'type' in transaction ||
			'maxFeePerGas' in transaction ||
			'maxPriorityFeePerGas' in transaction
		) {
			throw providerErrors.invalidParams(
				'Only legacy EIP-155 Web3 transactions are currently supported',
			)
		}
		const summary = await this.wallets.getSummary()
		const account = summary?.accounts.find(
			(candidate) =>
				candidate.addresses.standard.toLowerCase() === transaction.from.toLowerCase(),
		)
		const data = transaction.data ?? '0x'
		const approval: TransactionApprovalData = {
			kind: 'transaction',
			origin,
			network: this.approvalNetwork(network),
			...(account ? {account: {index: account.index, name: account.name}} : {}),
			from: transaction.from,
			...(transaction.to ? {to: transaction.to} : {}),
			value: transaction.value ?? '0x0',
			data,
			dataBytes: (data.length - 2) / 2,
			...(data.length >= 10 ? {selector: data.slice(0, 10) as `0x${string}`} : {}),
		}
		if (!this.approvals) {
			throw providerErrors.disconnected('Wallet approval service is unavailable')
		}
		await this.approvals.approveTransaction(approval)
		const currentNetwork = await this.networks.getActive()
		if (!currentNetwork || !this.sameNetwork(network, currentNetwork)) {
			throw providerErrors.disconnected('Wallet network changed while transaction approval was open')
		}

		const rpcChainId = readWeb3Quantity(
			await adapter.request({method: 'eth_chainId', params: []}),
			'eth_chainId',
		)
		if (rpcChainId !== BigInt(network.chainId)) {
			throw providerErrors.disconnected(
				`Web3 RPC chainId changed from ${network.chainId} to ${rpcChainId}`,
			)
		}
		const nonce = transaction.nonce === undefined
			? readWeb3Quantity(
				await adapter.request({
					method: 'eth_getTransactionCount',
					params: [transaction.from, 'pending'],
				}),
				'eth_getTransactionCount',
			)
			: readWeb3Quantity(transaction.nonce, 'nonce')
		const gasPrice = transaction.gasPrice === undefined
			? readWeb3Quantity(
				await adapter.request({method: 'eth_gasPrice', params: []}),
				'eth_gasPrice',
			)
			: readWeb3Quantity(transaction.gasPrice, 'gasPrice')
		const gasLimit = transaction.gas === undefined
			? readWeb3Quantity(
				await adapter.request({
					method: 'eth_estimateGas',
					params: [{
						from: transaction.from,
						...(transaction.to ? {to: transaction.to} : {}),
						data,
						value: transaction.value ?? '0x0',
					}],
				}),
				'eth_estimateGas',
			)
			: readWeb3Quantity(transaction.gas, 'gas')
		const signed = await this.wallets.signWeb3Transaction(transaction.from, {
			nonce,
			gasPrice,
			gasLimit,
			to: transaction.to ?? '',
			value: readWeb3Quantity(transaction.value ?? '0x0', 'value'),
			data,
			chainId: rpcChainId,
		})
		const result = await adapter.request({
			method: 'eth_sendRawTransaction',
			params: [signed.rawTransaction],
		})
		const returnedHash = readTransactionHash(result)
		if (returnedHash.toLowerCase() !== signed.transactionHash.toLowerCase()) {
			throw new Error('RPC returned a transaction hash that does not match the signed transaction')
		}
		await this.recordSubmittedTransaction(
			origin,
			transaction,
			network,
			returnedHash,
			`web3:${network.chainId}`,
		)
		return returnedHash
	}

	private async recordSubmittedTransaction(
		origin: string,
		transaction: ReturnType<typeof readProviderTransaction>,
		network: NetworkConfig,
		returnedHash: `0x${string}`,
		groupId: string,
		blockLimit?: bigint,
	): Promise<void> {
		try {
			const createdAt = Date.now()
			const activity: TransactionActivity = {
				id: `${createdAt}-${returnedHash.toLowerCase()}`,
				hash: returnedHash,
				origin,
				from: transaction.from,
				...(transaction.to ? {to: transaction.to} : {}),
				networkId: network.id,
				networkName: network.name,
				groupId,
				crypto: network.crypto,
				createdAt: new Date(createdAt).toISOString(),
				status: 'submitted',
				...(blockLimit === undefined ? {} : {blockLimit: blockLimit.toString(10)}),
			}
			if (this.transactionTracker) {
				await this.transactionTracker.track(activity, {
					activityId: activity.id,
					hash: returnedHash,
					network: {...network},
					...(blockLimit === undefined ? {} : {blockLimit: blockLimit.toString(10)}),
					attempts: 0,
					maxAttempts: this.transactionTracker.maxAttempts ?? TRANSACTION_MAX_ATTEMPTS,
					expiresAt: createdAt + TRANSACTION_MONITOR_TIMEOUT_MS,
					nextCheckAt:
						createdAt +
						(this.transactionTracker.initialPollDelayMs ??
							this.transactionTracker.pollIntervalMs ??
							TRANSACTION_POLL_INTERVAL_MS),
				})
			} else {
				await this.activities?.add(activity)
			}
		} catch {
			// The transaction is already broadcast. Activity persistence is best-effort so callers
			// cannot mistake a local storage failure for an RPC failure and submit it again.
		}
	}

	private async getTransactionNetworkMetadata(
		adapter: Awaited<ReturnType<ChainAdapterFactory['create']>>,
	): Promise<FiscoTransactionNetworkMetadata> {
		const value = await adapter.request({
			method: 'fisco_getGroupInfo',
			params: [],
		})
		return readFiscoTransactionNetworkMetadata(value)
	}

	private assertTransactionNetwork(
		network: NetworkConfig,
		metadata: FiscoTransactionNetworkMetadata,
	): void {
		const detectedCrypto: CryptoKind = metadata.smCryptoType ? 'gm' : 'standard'
		if (network.crypto !== detectedCrypto) {
			throw providerErrors.disconnected(
				`Configured crypto mode ${network.crypto} does not match RPC group mode ${detectedCrypto}`,
			)
		}
		if (metadata.isWasm) {
			throw providerErrors.unsupported('eth_sendTransaction on a WASM FISCO group')
		}
	}

	private assertV0ProviderFields(transaction: ReturnType<typeof readProviderTransaction>): void {
		if (transaction.value !== undefined && BigInt(transaction.value) !== 0n) {
			throw providerErrors.invalidParams(
				'FISCO BCOS 3.2 V0 transactions do not support a non-zero value',
			)
		}
		if (transaction.nonce !== undefined) {
			throw providerErrors.invalidParams(
				'FISCO BCOS V0 nonce is generated securely by the wallet',
			)
		}
	}

	private async requireActiveNetwork(): Promise<NetworkConfig> {
		const network = await this.networks.getActive()
		if (!network) throw providerErrors.disconnected('No active FISCO BCOS network is configured')
		return network
	}

	private approvalNetwork(network: NetworkConfig) {
		return {
			id: network.id,
			name: network.name,
			rpcUrl: network.rpcUrl,
			groupId: network.groupId,
			chainId: network.chainId,
			crypto: network.crypto,
		}
	}

	private sameNetwork(a: NetworkConfig, b: NetworkConfig): boolean {
		return (
			a.id === b.id &&
			a.rpcUrl === b.rpcUrl &&
			a.groupId === b.groupId &&
			a.chainId === b.chainId &&
			a.crypto === b.crypto
		)
	}

	private sameTransactionMetadata(
		a: FiscoTransactionNetworkMetadata,
		b: FiscoTransactionNetworkMetadata,
	): boolean {
		return (
			a.chainID === b.chainID &&
			a.groupID === b.groupID &&
			a.compatibilityVersion === b.compatibilityVersion &&
			a.compatibilityVersionText === b.compatibilityVersionText &&
			a.smCryptoType === b.smCryptoType &&
			a.isWasm === b.isWasm
		)
	}

	private async switchGroup(
		origin: string,
		params: ProviderRequest['params'],
	): Promise<null> {
		const groupId = readSwitchGroupId(params)
		const [networks, active, summary, authorized] = await Promise.all([
			this.networks.getAll(),
			this.networks.getActive(),
			this.wallets.getSummary(),
			this.permissions.accountsFor(origin),
		])
		const network = selectGroupNetwork(networks, active, groupId)
		if (active?.id === network.id) return null
		await this.approveNetworkSwitch(origin, 'group', active, network)
		await this.assertSwitchTargetsRemain(active, network)
		await this.networks.setActive(network)
		if (active && summary && authorized.length) {
			const oldAddresses = new Set(authorized.map((address) => address.toLowerCase()))
			const selectedAccounts = summary.accounts.filter((account) =>
				oldAddresses.has(account.addresses[active.crypto].toLowerCase()),
			)
			if (selectedAccounts.length) {
				await this.permissions.grant(
					origin,
					selectedAccounts.map((account) => account.addresses[network.crypto]),
				)
			}
		}
		this.broadcastProviderState(['group', 'accounts'])
		return null
	}

	private async switchChain(
		origin: string,
		params: ProviderRequest['params'],
	): Promise<null> {
		const chainId = readSwitchChainId(params)
		const [networks, active, summary, authorized] = await Promise.all([
			this.networks.getAll(),
			this.networks.getActive(),
			this.wallets.getSummary(),
			this.permissions.accountsFor(origin),
		])
		const candidates = networks.filter((network) => network.chainId === chainId)
		if (!candidates.length) throw providerErrors.chainNotFound(toChainId(chainId))
		if (candidates.length > 1) {
			throw providerErrors.invalidParams(
				`Chain ID is ambiguous across configured networks: ${toChainId(chainId)}`,
			)
		}
		const network = candidates[0]!
		if (active?.id === network.id) return null
		await this.approveNetworkSwitch(origin, 'chain', active, network)
		await this.assertSwitchTargetsRemain(active, network)
		await this.networks.setActive(network)
		if (active && summary && authorized.length) {
			const oldAddresses = new Set(authorized.map((address) => address.toLowerCase()))
			const selectedAccounts = summary.accounts.filter((account) =>
				oldAddresses.has(account.addresses[active.crypto].toLowerCase()),
			)
			if (selectedAccounts.length) {
				await this.permissions.grant(
					origin,
					selectedAccounts.map((account) => account.addresses[network.crypto]),
				)
			}
		}
		this.broadcastProviderState(['chain', 'group', 'accounts'])
		return null
	}

	private async approveNetworkSwitch(
		origin: string,
		requestType: SwitchApprovalData['requestType'],
		active: NetworkConfig | undefined,
		network: NetworkConfig,
	): Promise<void> {
		if (!active) throw providerErrors.disconnected('No active network is configured')
		if (!this.approvals) {
			throw providerErrors.disconnected('Wallet approval service is unavailable')
		}
		await this.approvals.approveSwitch({
			kind: 'switch',
			origin,
			requestType,
			currentNetwork: this.approvalNetwork(active),
			network: this.approvalNetwork(network),
		})
	}

	private async assertSwitchTargetsRemain(
		active: NetworkConfig | undefined,
		target: NetworkConfig,
	): Promise<void> {
		const [currentActive, currentNetworks] = await Promise.all([
			this.networks.getActive(),
			this.networks.getAll(),
		])
		if (!active || !currentActive || !this.sameNetwork(active, currentActive)) {
			throw providerErrors.disconnected('Wallet network changed while switch approval was open')
		}
		const currentTarget = currentNetworks.find((network) => network.id === target.id)
		if (!currentTarget || !this.sameNetwork(target, currentTarget)) {
			throw providerErrors.disconnected('Requested network changed while switch approval was open')
		}
	}
}

const toChainId = (chainId: number): `0x${string}` => `0x${chainId.toString(16)}`

const readSwitchChainId = (params: ProviderRequest['params']): number => {
	if (!Array.isArray(params) || params.length !== 1) {
		throw providerErrors.invalidParams('Expected [{ chainId: "0x1" }]')
	}
	const input = params[0]
	const value =
		input && typeof input === 'object' && 'chainId' in input
			? (input as {chainId?: unknown}).chainId
			: undefined
	if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
		throw providerErrors.invalidParams('chainId must be a hexadecimal quantity')
	}
	const chainId = Number(BigInt(value))
	if (!Number.isSafeInteger(chainId)) {
		throw providerErrors.invalidParams('chainId exceeds the supported integer range')
	}
	return chainId
}

const readWeb3Quantity = (value: unknown, method: string): bigint => {
	if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
		throw new Error(`${method} returned an invalid hexadecimal quantity`)
	}
	return BigInt(value)
}
