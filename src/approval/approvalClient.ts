import type {
	ApprovalData,
	ApprovalKind,
	ApprovalRuntimeRequest,
	ApprovalRuntimeResponse,
} from '@/shared/approvalMessages'

const send = (message: ApprovalRuntimeRequest): Promise<ApprovalRuntimeResponse['result']> =>
	new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(message, (response: ApprovalRuntimeResponse | undefined) => {
			const runtimeError = chrome.runtime.lastError
			if (runtimeError) return reject(new Error(runtimeError.message))
			if (!response) return reject(new Error('钱包后台没有响应'))
			if (response.error) return reject(new Error(response.error.message))
			resolve(response.result)
		})
	})

export const getApproval = async (token: string, kind: ApprovalKind): Promise<ApprovalData> => {
	const result = await send({type: 'APPROVAL_GET', token, kind})
	if (!result?.data) throw new Error('审批请求已失效或不存在')
	return result.data
}

export const resolveApproval = (
	token: string,
	kind: ApprovalKind,
	approved: boolean,
	accountIndexes?: number[],
): Promise<ApprovalRuntimeResponse['result']> =>
	send({type: 'APPROVAL_RESOLVE', token, kind, approved, accountIndexes})

export const heartbeatApproval = (
	token: string,
	kind: ApprovalKind,
): Promise<ApprovalRuntimeResponse['result']> =>
	send({type: 'APPROVAL_HEARTBEAT', token, kind})
