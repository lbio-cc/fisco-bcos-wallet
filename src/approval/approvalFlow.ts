import type {WalletStatus} from '@/core/wallet/types'

export type ApprovalGate =
	| { state: 'ready' }
	| { state: 'unlock' }
	| { state: 'error'; message: string }

const gateFromStatus = (status: WalletStatus): ApprovalGate => {
	if (!status.initialized) {
		return {state: 'error', message: '钱包尚未创建或恢复，请先在钱包中完成初始化'}
	}
	return {state: status.locked ? 'unlock' : 'ready'}
}

export const readApprovalGate = async (
	getStatus: () => Promise<WalletStatus>,
): Promise<ApprovalGate> => gateFromStatus(await getStatus())

export const unlockApprovalGate = async (
	password: string,
	unlock: (input: { password: string }) => Promise<WalletStatus>,
): Promise<ApprovalGate> => gateFromStatus(await unlock({password}))

