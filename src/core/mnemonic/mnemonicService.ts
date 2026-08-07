import {HDKey} from '@scure/bip32'
import {
	generateMnemonic as generateBip39Mnemonic,
	mnemonicToSeedSync,
	validateMnemonic as validateBip39Mnemonic,
} from '@scure/bip39'
import {wordlist} from '@scure/bip39/wordlists/english.js'
import {secp256k1} from '@noble/curves/secp256k1.js'
import {keccak_256} from '@noble/hashes/sha3.js'
import smCrypto from 'sm-crypto'
import type {CryptoKind, Hex} from '../../shared/types'

export type MnemonicWordCount = 12 | 24

export interface DerivedMnemonicAccount {
	addresses: Record<CryptoKind, Hex>
	publicKeys: Record<CryptoKind, Hex>
	privateKey: Hex
	derivationPath: string
	derivationScheme: 'bip32-secp256k1-v1'
}

const STANDARD_PATH_PREFIX = "m/44'/60'/0'/0"
const SM2_ORDER = BigInt('0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFF7203DF6B21C6052B53BBF40939D54123')

const bytesToHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const hexToBytes = (hex: string): Uint8Array => {
	const normalized = hex.startsWith('0x') ? hex.slice(2) : hex
	if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length % 2 !== 0) {
		throw new Error('Invalid hexadecimal value')
	}
	return Uint8Array.from(normalized.match(/.{2}/g) ?? [], (value) => Number.parseInt(value, 16))
}

const bigintTo32Bytes = (value: bigint): Uint8Array =>
	hexToBytes(value.toString(16).padStart(64, '0'))

export const normalizeMnemonic = (mnemonic: string): string =>
	mnemonic.normalize('NFKD').trim().toLowerCase().split(/\s+/u).filter(Boolean).join(' ')

export const validateMnemonic = (mnemonic: string): boolean => {
	const normalized = normalizeMnemonic(mnemonic)
	const wordCount = normalized ? normalized.split(' ').length : 0
	return (wordCount === 12 || wordCount === 24) && validateBip39Mnemonic(normalized, wordlist)
}

export const generateMnemonic = (wordCount: MnemonicWordCount = 12): string => {
	if (wordCount !== 12 && wordCount !== 24) throw new Error('Only 12 or 24 words are supported')
	return generateBip39Mnemonic(wordlist, wordCount === 12 ? 128 : 256)
}

export const deriveMnemonicAccount = (
	mnemonic: string,
	accountIndex = 0,
): DerivedMnemonicAccount => {
	const normalized = normalizeMnemonic(mnemonic)
	if (!validateMnemonic(normalized))
		throw new Error('Only valid 12 or 24 word BIP-39 mnemonics are supported')
	if (!Number.isSafeInteger(accountIndex) || accountIndex < 0 || accountIndex >= 0x80000000) {
		throw new Error('Account index must be an integer between 0 and 2147483647')
	}

	const seed = mnemonicToSeedSync(normalized)
	try {
		return deriveAccount(seed, accountIndex)
	} finally {
		seed.fill(0)
	}
}

const deriveAccount = (seed: Uint8Array, index: number): DerivedMnemonicAccount => {
	const derivationPath = `${STANDARD_PATH_PREFIX}/${index}`
	const node = HDKey.fromMasterSeed(seed).derive(derivationPath)
	if (!node.privateKey) throw new Error('Unable to derive account private key')
	const derivedPrivateKey = Uint8Array.from(node.privateKey)
	const scalar = BigInt(`0x${bytesToHex(derivedPrivateKey)}`)
	const privateKey =
		scalar < SM2_ORDER ? derivedPrivateKey : bigintTo32Bytes((scalar % (SM2_ORDER - 1n)) + 1n)
	try {
		const standard = deriveAccountMaterial(privateKey, 'standard')
		const gm = deriveAccountMaterial(privateKey, 'gm')
		return {
			addresses: {standard: standard.address, gm: gm.address},
			publicKeys: {standard: standard.publicKey, gm: gm.publicKey},
			privateKey: `0x${bytesToHex(privateKey)}`,
			derivationPath,
			derivationScheme: 'bip32-secp256k1-v1',
		}
	} finally {
		node.wipePrivateData()
		derivedPrivateKey.fill(0)
		privateKey.fill(0)
	}
}

export const deriveAccountMaterial = (
	privateKeyInput: Uint8Array | Hex,
	cryptoKind: CryptoKind,
): { address: Hex; publicKey: Hex } => {
	const privateKey =
		typeof privateKeyInput === 'string'
			? hexToBytes(privateKeyInput)
			: Uint8Array.from(privateKeyInput)
	try {
		if (privateKey.length !== 32) throw new Error('Account private key must be 32 bytes')
		const scalar = BigInt(`0x${bytesToHex(privateKey)}`)
		if (scalar === 0n || (cryptoKind === 'gm' && scalar >= SM2_ORDER)) {
			throw new Error('Derived private key is outside the SM2 scalar range')
		}

		if (cryptoKind === 'standard') {
			const publicKey = secp256k1.getPublicKey(privateKey, false).slice(1)
			const address = keccak_256(publicKey).slice(-20)
			return {
				address: `0x${bytesToHex(address)}`,
				publicKey: `0x${bytesToHex(publicKey)}`,
			}
		}

		const publicKeyHex = smCrypto.sm2.getPublicKeyFromPrivateKey(bytesToHex(privateKey))
		const publicKey = publicKeyHex.startsWith('04') ? publicKeyHex.slice(2) : publicKeyHex
		return {
			address: deriveFiscoGmAddress(publicKey),
			publicKey: `0x${publicKey.toLowerCase()}`,
		}
	} finally {
		privateKey.fill(0)
	}
}

/** Matches FISCO BCOS Java SDK CryptoKeyPair.getAddress with SM3Hash. */
export const deriveFiscoGmAddress = (publicKeyHex: string): Hex => {
	const normalized = publicKeyHex.startsWith('0x') ? publicKeyHex.slice(2) : publicKeyHex
	const publicKeyNoPrefix =
		normalized.length === 130 && normalized.startsWith('04') ? normalized.slice(2) : normalized
	if (!/^[0-9a-f]{128}$/i.test(publicKeyNoPrefix)) {
		throw new Error(
			'SM2 public key must be a 64-byte uncompressed key, optionally prefixed with 04',
		)
	}
	const publicKeyHash = smCrypto.sm3(Array.from(hexToBytes(publicKeyNoPrefix)))
	return `0x${publicKeyHash.slice(-40).toLowerCase()}`
}
