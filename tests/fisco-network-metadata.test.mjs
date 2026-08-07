import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeFiscoCompatibilityVersion,
  readFiscoBlockNumber,
  readFiscoTransactionNetworkMetadata,
} from '../src/core/transaction/fiscoNetworkMetadata.ts'

const groupInfo = {
  chainID: 'chain0',
  groupID: 'testchain',
  nodeList: [
    {
      iniConfig: JSON.stringify({
        chainID: 'chain0',
        groupID: 'testchain',
        isWasm: false,
        smCryptoType: true,
      }),
      protocol: {
        compatibilityVersion: 50462720,
        maxSupportedVersion: 1,
        minSupportedVersion: 0,
      },
    },
  ],
}

test('extracts only transaction metadata from getGroupInfo', () => {
  assert.deepEqual(readFiscoTransactionNetworkMetadata(groupInfo), {
    chainID: 'chain0',
    groupID: 'testchain',
    compatibilityVersion: 50462720,
    compatibilityVersionText: '3.2.0',
    smCryptoType: true,
    isWasm: false,
  })
  assert.equal(decodeFiscoCompatibilityVersion(50462720), '3.2.0')
})

test('reads decimal, numeric and hexadecimal FISCO block numbers', () => {
  assert.equal(readFiscoBlockNumber(40), 40n)
  assert.equal(readFiscoBlockNumber('40'), 40n)
  assert.equal(readFiscoBlockNumber('0x28'), 40n)
})

test('rejects incomplete or inconsistent group metadata', () => {
  assert.throws(() => readFiscoTransactionNetworkMetadata({}), /malformed/i)
  assert.throws(
    () =>
      readFiscoTransactionNetworkMetadata({
        ...groupInfo,
        nodeList: [
          ...groupInfo.nodeList,
          {
            ...groupInfo.nodeList[0],
            iniConfig: JSON.stringify({ isWasm: false, smCryptoType: false }),
          },
        ],
      }),
    /disagree/i,
  )
  assert.throws(() => readFiscoBlockNumber(-1), /malformed/i)
})
