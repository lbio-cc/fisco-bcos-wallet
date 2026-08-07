import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = (
  await Promise.all(
    [
      '../src/components/home/WalletActivityView.vue',
      '../src/composables/useWalletController.ts',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  )
).join('\n')
const activityList = source.match(/<ol v-else class="activity-list">([\s\S]*?)<\/ol>/)?.[1] ?? ''
const copyButtons = [...source.matchAll(/<CopyButton[\s\S]*?\/>/g)].map((match) => match[0])

test('activity cards expose all five Chinese transaction states', () => {
  for (const label of ['确认中', '已成功', '执行失败', '已过期', '查询超时']) {
    assert.match(source, new RegExp(label))
  }
})

test('activity cards omit sender, request origin, and detailed network receipt fields', () => {
  assert.ok(activityList)
  assert.doesNotMatch(activityList, /activity\.from|activity\.origin|originHost/)
  assert.doesNotMatch(activityList, /networkName|groupId|receiptStatus|failureMessage/)
  assert.match(activityList, /activity\.to \? `发往/)
})

test('list hash copy uses the complete value and cannot open the detail dialog', () => {
  const listHashCopy = copyButtons.find((button) => button.includes(':value="activity.hash"')) ?? ''
  assert.ok(listHashCopy)
  assert.match(listHashCopy, /:feedback-key="`activity-hash-\$\{activity\.id\}`"/)
  assert.match(listHashCopy, /label="复制交易哈希"/)
  assert.match(listHashCopy, /@click\.stop/)
  assert.match(listHashCopy, /@keydown\.stop/)
})

test('activity cards open details by pointer, Enter, and Space', () => {
  assert.match(activityList, /role="button"[\s\S]*?tabindex="0"/)
  assert.match(activityList, /@click="openActivityDetail\(activity, \$event\)"/)
  assert.match(activityList, /@keydown\.enter\.prevent="openActivityDetail\(activity, \$event\)"/)
  assert.match(activityList, /@keydown\.space\.prevent="openActivityDetail\(activity, \$event\)"/)
})

test('detail dialog exposes complete transaction, address, network, source, and receipt data', () => {
  const dialogTag = source.match(/<section\s+id="activity-detail-dialog"[\s\S]*?>/)?.[0] ?? ''
  assert.ok(dialogTag)
  assert.match(dialogTag, /role="dialog"/)
  assert.match(dialogTag, /aria-modal="true"/)
  assert.match(dialogTag, /aria-labelledby="activity-detail-title"/)
  for (const field of [
    'selectedActivity.hash',
    'selectedActivity.from',
    'selectedActivity.to',
    'selectedActivity.networkName',
    'selectedActivity.groupId',
    'selectedActivity.origin',
    'selectedActivity.blockLimit',
    'selectedActivity.confirmedAt',
    'selectedActivity.receiptBlockNumber',
    'selectedActivity.receiptStatus',
    'selectedActivity.failureMessage',
  ]) {
    assert.match(source, new RegExp(field.replace('.', '\\.')))
  }
  const fromCopy = copyButtons.find((button) =>
    button.includes(':value="selectedActivity.from"')) ?? ''
  const toCopy = copyButtons.find((button) =>
    button.includes(':value="selectedActivity.to ?? \'\'"')) ?? ''
  assert.match(fromCopy, /:feedback-key="`activity-detail-from-/)
  assert.match(toCopy, /:feedback-key="`activity-detail-to-/)
})

test('detail dialog closes from its button, backdrop, and Escape while restoring focus', () => {
  assert.match(source, /@click\.self="closeActivityDetail"/)
  const closeButton = source.match(/<button[^>]*aria-label="关闭交易详情"[^>]*>/)?.[0] ?? ''
  assert.match(closeButton, /@click="closeActivityDetail"/)
  assert.match(
    source,
    /event\.key === 'Escape' && selectedActivity\.value[\s\S]*?closeActivityDetail\(\)/,
  )
  assert.match(source, /activityDetailTrigger[\s\S]*?nextTick\(\(\) => trigger\?\.focus\(\)\)/)
})

test('storage activity changes are wired to refresh the open wallet home', () => {
  assert.match(
    source,
    /subscribeToTransactionActivities\(\(\) => \{[\s\S]*?view\.value === 'done'[\s\S]*?refreshHome\(\)/,
  )
})
