import assert from 'node:assert/strict'
import test from 'node:test'

import { signAndEncodeWeb3Transaction } from '../src/core/transaction/web3Transaction.ts'

test('encodes the canonical EIP-155 protected legacy transaction vector', () => {
  const signed = signAndEncodeWeb3Transaction(
    {
      nonce: 9n,
      gasPrice: 20_000_000_000n,
      gasLimit: 21_000n,
      to: '0x3535353535353535353535353535353535353535',
      value: 1_000_000_000_000_000_000n,
      data: '0x',
      chainId: 1n,
    },
    '0x4646464646464646464646464646464646464646464646464646464646464646',
  )

  assert.equal(
    signed.rawTransaction,
    '0xf86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83',
  )
  assert.match(signed.transactionHash, /^0x[0-9a-f]{64}$/)
})

test('supports contract calls and chain ids whose EIP-155 v exceeds one byte', () => {
  const signed = signAndEncodeWeb3Transaction(
    {
      nonce: 0n,
      gasPrice: 0n,
      gasLimit: 3_000_000n,
      to: '0xb001d0dc0e888e343b0e1056e7db070b0270650b',
      value: 0n,
      data: '0x3590b49f00',
      chainId: 20_200n,
    },
    '0x4646464646464646464646464646464646464646464646464646464646464646',
  )

  assert.match(signed.rawTransaction, /^0xf8[0-9a-f]+/)
  assert.match(signed.transactionHash, /^0x[0-9a-f]{64}$/)
})
