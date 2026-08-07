export interface CreateWalletForm {
	name: string
	wordCount: 12 | 24
	password: string
	passwordConfirm: string
}

export interface RestoreWalletForm {
	name: string
	mnemonic: string
	password: string
	passwordConfirm: string
}
