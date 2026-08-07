import assert from 'node:assert/strict'
import test from 'node:test'

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import smCrypto from 'sm-crypto'

import {
  bytesToHex,
  createFiscoNonce,
  encodeFiscoV0TransactionData,
  hexToBytes,
  serializeFiscoV0HashFields,
  signAndEncodeFiscoV0Transaction,
} from '../src/core/transaction/fiscoV0Transaction.ts'

const privateKey = `0x${'1'.padStart(64, '0')}`
const publicKey = smCrypto.sm2.getPublicKeyFromPrivateKey(privateKey.slice(2)).slice(2)
const data = {
  version: 0,
  chainID: 'c',
  groupID: 'g',
  blockLimit: 128n,
  nonce: '1',
  to: '',
  input: Uint8Array.of(0x12, 0x34),
  abi: '',
}

test('encodes FISCO BCOS 3.2 TransactionData with canonical Tars fields', () => {
  assert.equal(
    bytesToHex(encodeFiscoV0TransactionData(data)),
    '1c26016336016741008056013166007d0000021234',
  )
  assert.equal(
    bytesToHex(encodeFiscoV0TransactionData({ ...data, abi: '[]' })),
    '1c26016336016741008056013166007d000002123486025b5d',
  )
})

test('serializes V0 hash fields in the node 3.2 protocol order', () => {
  assert.equal(
    bytesToHex(serializeFiscoV0HashFields(data)),
    '0000000063670000000000000080311234',
  )
  assert.equal(
    smCrypto.sm3(Array.from(serializeFiscoV0HashFields(data))),
    '9a1d639ca3b07204a107276ea3869069393b89c7a6cf956b1b5ce39dd634b9b9',
  )
})

test('creates an SM3/SM2 signed Tars transaction with r, s and public key', () => {
  const signed = signAndEncodeFiscoV0Transaction(data, {
    crypto: 'gm',
    privateKey,
    publicKey: `0x${publicKey}`,
  })
  const hash = smCrypto.sm3(Array.from(serializeFiscoV0HashFields(data)))

  assert.equal(signed.transactionHash, `0x${hash}`)
  assert.match(signed.rawTransaction, /^0x1a/)
  assert.ok(signed.rawTransaction.includes(`2d000020${hash}`))
  const signatureMarker = '3d00010080'
  const signatureOffset = signed.rawTransaction.indexOf(signatureMarker) + signatureMarker.length
  assert.ok(signatureOffset >= signatureMarker.length)
  assert.ok(signed.rawTransaction.endsWith('5001'))

  const signatureAndPublicKey = signed.rawTransaction.slice(
    signatureOffset,
    signatureOffset + 256,
  )
  assert.equal(signatureAndPublicKey.slice(128), publicKey)
  assert.equal(
    smCrypto.sm2.doVerifySignature(
      Array.from(hexToBytes(hash)),
      signatureAndPublicKey.slice(0, 128),
      `04${publicKey}`,
      {
        hash: true,
        der: false,
        userId: '1234567812345678',
      },
    ),
    true,
  )
  assert.equal(
    smCrypto.sm2.doVerifySignature(
      Array.from(hexToBytes(hash)),
      signatureAndPublicKey.slice(0, 128),
      `04${publicKey}`,
      { hash: false, der: false },
    ),
    false,
  )
})

test('creates a Keccak/secp256k1 signed V0 transaction for standard groups', () => {
  const privateKeyBytes = hexToBytes(privateKey)
  const standardPublicKey = secp256k1.getPublicKey(privateKeyBytes, false)
  const signed = signAndEncodeFiscoV0Transaction(data, {
    crypto: 'standard',
    privateKey,
    publicKey: `0x${bytesToHex(standardPublicKey.slice(1))}`,
  })
  const hash = keccak_256(serializeFiscoV0HashFields(data))
  const signatureMarker = '3d000041'
  const signatureOffset = signed.rawTransaction.indexOf(signatureMarker) + signatureMarker.length
  const signature = hexToBytes(
    signed.rawTransaction.slice(signatureOffset, signatureOffset + 130),
  )

  assert.equal(signed.transactionHash, `0x${bytesToHex(hash)}`)
  assert.ok(signed.rawTransaction.includes('3d000041'))
  assert.ok(signed.rawTransaction.endsWith('5001'))
  assert.equal(
    secp256k1.verify(signature.slice(0, 64), hash, standardPublicKey, {
      prehash: false,
      lowS: true,
      format: 'compact',
    }),
    true,
  )
  assert.ok(signature[64] === 0 || signature[64] === 1)
})

test('generates a fixed-width 40-digit decimal nonce', () => {
  assert.match(createFiscoNonce(), /^[1-9][0-9]{39}$/)
  assert.throws(
    () => encodeFiscoV0TransactionData({ ...data, nonce: '0123' }),
    /without leading zeroes/,
  )
})
