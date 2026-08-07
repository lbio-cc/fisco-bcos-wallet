<script lang="ts" setup>
import {nextTick, onBeforeUnmount, onMounted, ref} from 'vue'
import {storeToRefs} from 'pinia'
import CopyButton from '@/components/common/CopyButton.vue'
import type {TransactionActivity} from '@/shared/walletHomeMessages'
import {useWalletHomeStore} from '@/stores/walletHome'

const home = useWalletHomeStore()
const {
	loading: homeLoading,
	error: homeError,
	currentAccountActivities,
} = storeToRefs(home)

const selectedActivity = ref<TransactionActivity>()
const activityDialog = ref<HTMLElement>()
let activityDetailTrigger: HTMLElement | null = null

const compact = (value?: string, start = 8, end = 6): string => {
	if (!value) return '—'
	return value.length > start + end + 1
		? `${value.slice(0, start)}…${value.slice(-end)}`
		: value
}

const originHost = (origin: string): string => {
	try {
		return new URL(origin).host
	} catch {
		return origin
	}
}

const formatActivityTimestamp = (value?: string): string => {
	if (!value) return '—'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return value
	return new Intl.DateTimeFormat('zh-CN', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).format(date)
}

const formatActivityTime = (activity: TransactionActivity): string =>
	formatActivityTimestamp(activity.createdAt)

const formatActivityListTime = (activity: TransactionActivity): string =>
	new Intl.DateTimeFormat('zh-CN', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(new Date(activity.createdAt))

const activityStatusLabel = (status: TransactionActivity['status']): string =>
	({
		submitted: '确认中',
		success: '已成功',
		failed: '执行失败',
		expired: '已过期',
		timeout: '查询超时',
	})[status]

const activityFailureText = (activity: TransactionActivity): string | undefined => {
	if (activity.status === 'failed') return '交易已上链，但执行未成功'
	if (activity.status === 'expired') return '超过有效块高，仍未获得交易回执'
	if (activity.status === 'timeout') return '已停止自动查询，可稍后通过交易哈希核对'
	return undefined
}

const openActivityDetail = (activity: TransactionActivity, event?: Event): void => {
	selectedActivity.value = activity
	activityDetailTrigger =
		event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
	void nextTick(() => activityDialog.value?.focus())
}

const closeActivityDetail = (): void => {
	if (!selectedActivity.value) return
	selectedActivity.value = undefined
	const trigger = activityDetailTrigger
	activityDetailTrigger = null
	void nextTick(() => trigger?.focus())
}

const handleKeydown = (event: KeyboardEvent): void => {
	if (event.key === 'Escape' && selectedActivity.value) {
		event.preventDefault()
		closeActivityDetail()
	}
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
	<section aria-label="交易活动" class="activity-view">
		<p class="activity-scope-note">仅显示当前账户在当前网络中的记录</p>
		<div v-if="homeLoading" class="activity-loading">
			<span class="spinner"></span>正在读取活动…
		</div>
		<div v-else-if="!currentAccountActivities.length" class="home-empty compact-empty">
			<p>交易记录</p>
			<h1>当前网络暂无活动</h1>
			<span>当前账户在此网络提交的交易会显示在这里。</span>
		</div>
		<ol v-else class="activity-list">
			<li v-for="activity in currentAccountActivities" :key="activity.id">
				<article
					:aria-label="`查看交易 ${compact(activity.hash, 8, 6)} 的详情`"
					class="activity-card"
					role="button"
					tabindex="0"
					@click="openActivityDetail(activity, $event)"
					@keydown.enter.prevent="openActivityDetail(activity, $event)"
					@keydown.space.prevent="openActivityDetail(activity, $event)"
				>
					<header>
                  <span :class="`activity-status status-${activity.status}`">
                    <i></i>{{ activityStatusLabel(activity.status) }}
                  </span>
						<time :datetime="activity.createdAt">{{ formatActivityListTime(activity) }}</time>
					</header>
					<div class="activity-hash-row">
						<span>交易哈希</span>
						<code :title="activity.hash">{{ compact(activity.hash, 10, 8) }}</code>
						<CopyButton
							:feedback-key="`activity-hash-${activity.id}`"
							:value="activity.hash"
							class="activity-copy-button"
							label="复制交易哈希"
							@click.stop
							@keydown.stop
						/>
					</div>
					<footer>
						<span>{{ activity.to ? `发往 ${compact(activity.to, 7, 5)}` : '创建合约' }}</span>
						<span class="activity-detail-hint">查看详情 <i aria-hidden="true">›</i></span>
					</footer>
				</article>
			</li>
		</ol>
		<p v-if="homeError" class="error">{{ homeError }}</p>
	</section>

	<div
		v-if="selectedActivity"
		class="activity-dialog-backdrop"
		@click.self="closeActivityDetail"
	>
		<section
			id="activity-detail-dialog"
			ref="activityDialog"
			aria-labelledby="activity-detail-title"
			aria-modal="true"
			class="activity-dialog"
			role="dialog"
			tabindex="-1"
		>
			<header class="activity-dialog-header">
				<div>
					<p>交易回执</p>
					<h1 id="activity-detail-title">交易详情</h1>
				</div>
				<button aria-label="关闭交易详情" type="button" @click="closeActivityDetail">×</button>
			</header>

			<div class="activity-dialog-summary">
          <span :class="`activity-status status-${selectedActivity.status}`">
            <i></i>{{ activityStatusLabel(selectedActivity.status) }}
          </span>
				<time :datetime="selectedActivity.createdAt">{{ formatActivityTime(selectedActivity) }}</time>
			</div>

			<div class="activity-dialog-content">
				<section aria-labelledby="activity-transaction-title" class="activity-detail-group">
					<h2 id="activity-transaction-title">交易</h2>
					<dl>
						<div class="activity-detail-full">
							<dt>交易哈希</dt>
							<dd class="activity-detail-copy">
								<code>{{ selectedActivity.hash }}</code>
								<CopyButton
									:feedback-key="`activity-detail-hash-${selectedActivity.id}`"
									:value="selectedActivity.hash"
									label="复制完整交易哈希"
								/>
							</dd>
						</div>
					</dl>
				</section>

				<section aria-labelledby="activity-address-title" class="activity-detail-group">
					<h2 id="activity-address-title">地址</h2>
					<dl>
						<div class="activity-detail-full">
							<dt>发送方</dt>
							<dd class="activity-detail-copy">
								<code>{{ selectedActivity.from }}</code>
								<CopyButton
									:feedback-key="`activity-detail-from-${selectedActivity.id}`"
									:value="selectedActivity.from"
									label="复制发送方地址"
								/>
							</dd>
						</div>
						<div class="activity-detail-full">
							<dt>接收方</dt>
							<dd v-if="selectedActivity.to" class="activity-detail-copy">
								<code>{{ selectedActivity.to }}</code>
								<CopyButton
									:feedback-key="`activity-detail-to-${selectedActivity.id}`"
									:value="selectedActivity.to ?? ''"
									label="复制接收方地址"
								/>
							</dd>
							<dd v-else>创建合约</dd>
						</div>
					</dl>
				</section>

				<section aria-labelledby="activity-network-title" class="activity-detail-group">
					<h2 id="activity-network-title">网络</h2>
					<dl class="activity-detail-grid">
						<div>
							<dt>网络名称</dt>
							<dd>{{ selectedActivity.networkName }}</dd>
						</div>
						<div>
							<dt>群组</dt>
							<dd>{{ selectedActivity.groupId }}</dd>
						</div>
						<div>
							<dt>密码学模式</dt>
							<dd>{{ selectedActivity.crypto === 'gm' ? '国密 SM2 / SM3' : '标准 secp256k1' }}</dd>
						</div>
						<div>
							<dt>请求网站</dt>
							<dd :title="selectedActivity.origin" class="activity-origin-detail">
								{{ originHost(selectedActivity.origin) }}
							</dd>
						</div>
					</dl>
				</section>

				<section aria-labelledby="activity-receipt-title" class="activity-detail-group">
					<h2 id="activity-receipt-title">回执</h2>
					<dl class="activity-detail-grid">
						<div>
							<dt>区块有效上限</dt>
							<dd>{{ selectedActivity.blockLimit ?? '—' }}</dd>
						</div>
						<div>
							<dt>确认时间</dt>
							<dd>{{ formatActivityTimestamp(selectedActivity.confirmedAt) }}</dd>
						</div>
						<div>
							<dt>回执区块</dt>
							<dd>{{ selectedActivity.receiptBlockNumber ?? '—' }}</dd>
						</div>
						<div>
							<dt>回执状态</dt>
							<dd>{{ selectedActivity.receiptStatus ?? '—' }}</dd>
						</div>
					</dl>
					<p v-if="selectedActivity.failureMessage || activityFailureText(selectedActivity)"
					   class="activity-detail-message">
						{{ selectedActivity.failureMessage ?? activityFailureText(selectedActivity) }}
					</p>
				</section>
			</div>
		</section>
	</div>
</template>

<style lang="scss" scoped>
.home-empty {
	min-height: 350px;
	display: grid;
	justify-items: center;
	align-content: center;
	padding: 28px 0;
	text-align: center;

	> div {
		width: 42px;
		height: 42px;
		display: grid;
		margin-bottom: 24px;
		place-items: center;
		border: 1px solid #8b96ae;
		color: #2457d6;
		box-shadow: 4px 4px 0 #d8d5cb;
		font: 800 18px/1 ui-monospace, monospace;
	}

	p {
		margin: 0 0 7px;
		color: #176b57;
		font-family: inherit;
		font-size: 11px;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: 0.05em;
	}

	h1 {
		margin: 0 0 9px;
		color: #17201d;
		font-size: 18px;
	}

	> span {
		max-width: 260px;
		color: #74807b;
		font-size: 12px;
		line-height: 1.7;
	}
}

.compact-empty {
	min-height: 280px;
}

.activity-view {
	padding-top: 14px;
}

.activity-scope-note {
	margin: 0 0 10px;
	color: #6d7380;
	font-size: 11px;
	line-height: 1.5;
}

.activity-loading {
	min-height: 280px;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	color: #6d7380;
	font-size: 11px;
}

.activity-list {
	display: grid;
	gap: 10px;
	margin: 0;
	padding: 0;
	list-style: none;

	li {
		padding: 12px 13px;
		border: 1px solid #bbb8ae;
		border-left: 3px solid #2f9161;
		background: #fffdf7;
		box-shadow: 2px 2px 0 #d8d5cb;
	}
}

.activity-list header,
.activity-origin,
.activity-list footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
}

.activity-list header > span {
	color: #287b54;
	font-size: 11px;
	font-weight: 750;
}

.activity-list header i {
	display: inline-block;
	width: 6px;
	height: 6px;
	margin-right: 5px;
	border-radius: 50%;
	background: #2f9161;
}

.activity-list time {
	color: #7a7f88;
	font: 600 10px/1 ui-monospace, monospace;
}

.activity-origin {
	margin-top: 8px;

	strong {
		overflow: hidden;
		color: #14213d;
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	code {
		color: #2457d6;
		font-size: 10px;
	}
}

.activity-list dl {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 8px;
	margin: 10px 0;
	padding: 8px 0;
	border-block: 1px solid #e1ded5;

	div {
		min-width: 0;
		display: grid;
		grid-template-columns: 50px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
	}
}

.activity-list dt {
	color: #888b91;
	font: 700 10px/1 ui-monospace, monospace;
}

.activity-list dd {
	margin: 0;
	color: #3b4659;
	font: 600 10px/1.2 ui-monospace, monospace;
}

.activity-list .status-submitted {
	color: #8a6517;

	i {
		background: #c48a22;
	}
}

.activity-list .status-success {
	color: #176b57;

	i {
		background: #2f8a6f;
	}
}

.activity-list .status-failed {
	color: #a3473d;

	i {
		background: #b8564b;
	}
}

.activity-list .status-expired,
.activity-list .status-timeout {
	color: #68716d;
}

.activity-list .status-expired i,
.activity-list .status-timeout i {
	background: #7e8984;
}

.activity-result-note {
	margin: -2px 0 10px;
	color: #7d4e45;
	font-size: 11px;
	line-height: 1.45;
}

.activity-list footer span,
.activity-list footer code {
	color: #697180;
	font-size: 10px;
}

.eyebrow,
.menu-panel > p,
.header-popover > p,
.connection-popover header p,
.menu-panel button small,
.authorized-accounts small,
.site-list > small,
.home-empty p,
.activity-list dt,
.account-select i,
.network-list > li > header span,
.network-row-actions > span,
.network-directory-empty small,
.network-card small,
.network-empty small,
.check-row small {
	font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}

.activity-list {
	gap: 10px;

	li {
		padding: 14px;
		border: 1px solid #e0e7e3;
		border-radius: 13px;
		background: #fff;
		box-shadow: none;
	}
}

.activity-list header > span,
.activity-origin code {
	color: #176b57;
}

.activity-list header i {
	background: #2f8a6f;
}

.activity-list dl {
	border-color: #e7ece9;
}

.activity-list dt {
	color: #7a8681;
	font-family: inherit;
}

.activity-list li {
	padding: 0;
	border: 0;
	border-radius: 0;
	background: transparent;
}

.activity-card {
	padding: 13px 14px 12px;
	border: 1px solid #e0e7e3;
	border-radius: 13px;
	background: #fff;
	cursor: pointer;
	transition: border-color 140ms ease,
	box-shadow 140ms ease,
	transform 140ms ease;

	&:hover {
		border-color: #b7d0c6;
		box-shadow: 0 6px 18px rgba(34, 74, 60, 0.07);
		transform: translateY(-1px);
	}

	&:focus-visible {
		outline: 3px solid rgba(23, 107, 87, 0.24);
		outline-offset: 2px;
	}
}

.activity-card header,
.activity-card footer,
.activity-hash-row {
	display: flex;
	align-items: center;
}

.activity-card header,
.activity-card footer {
	justify-content: space-between;
	gap: 12px;
}

.activity-hash-row {
	min-width: 0;
	gap: 7px;
	margin: 10px 0 9px;
	padding: 8px 9px;
	border-radius: 9px;
	background: #f4f7f5;

	> span:first-child {
		flex: 0 0 auto;
		color: #74807b;
		font-size: 10px;
		font-weight: 700;
	}

	code {
		min-width: 0;
		overflow: hidden;
		flex: 1 1 auto;
		color: #176b57;
		font: 650 11px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}

.activity-copy-button {
	flex: 0 0 auto;
	min-width: 30px;
	min-height: 27px;
	padding-inline: 5px;
	font-size: 10px;
}

.activity-card footer {
	color: #74807b;
	font-size: 11px;
	line-height: 1.3;
}

.activity-detail-hint {
	color: #176b57;
	font-weight: 720;

	i {
		margin-left: 3px;
		font-size: 17px;
		font-style: normal;
		line-height: 0;
		vertical-align: -1px;
	}
}

.activity-dialog-backdrop {
	position: fixed;
	z-index: 100;
	inset: 0;
	display: grid;
	place-items: center;
	padding: 14px;
	background: rgba(20, 37, 31, 0.4);
}

.activity-dialog {
	width: min(420px, 100%);
	max-height: min(680px, calc(100vh - 28px));
	overflow: hidden;
	border: 1px solid #cedbd6;
	border-radius: 16px;
	background: #fbfcfb;
	box-shadow: 0 20px 55px rgba(20, 45, 36, 0.2);

	&:focus {
		outline: none;
	}
}

.activity-dialog-header,
.activity-dialog-summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.activity-dialog-header {
	padding: 15px 16px 11px;
	border-bottom: 1px solid #e5ebe8;

	p {
		margin: 0 0 3px;
		color: #74807b;
		font-size: 10px;
		font-weight: 700;
	}

	h1 {
		margin: 0;
		color: #17201d;
		font-size: 18px;
		line-height: 1.2;
	}

	> button {
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid #d5e0dc;
		border-radius: 9px;
		color: #53615c;
		background: #fff;
		font-size: 22px;
		line-height: 1;

		&:hover {
			border-color: #9ebbb0;
			color: #176b57;
			background: #edf5f2;
		}
	}
}

.activity-dialog-summary {
	gap: 12px;
	padding: 10px 16px;
	color: #74807b;
	background: #f1f6f4;
	font-size: 11px;

	time {
		font: 600 10px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
	}
}

.activity-dialog .activity-status {
	color: #176b57;
	font-size: 11px;
	font-weight: 750;

	i {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin-right: 5px;
		border-radius: 50%;
		background: #2f8a6f;
	}
}

.activity-dialog .status-submitted {
	color: #8a6517;

	i {
		background: #c48a22;
	}
}

.activity-dialog .status-failed {
	color: #a3473d;

	i {
		background: #b8564b;
	}
}

.activity-dialog .status-expired,
.activity-dialog .status-timeout {
	color: #68716d;
}

.activity-dialog .status-expired i,
.activity-dialog .status-timeout i {
	background: #7e8984;
}

.activity-dialog-content {
	max-height: calc(min(680px, 100vh - 28px) - 123px);
	overflow-y: auto;
	padding: 13px 16px 22px;
	overscroll-behavior: contain;
}

.activity-detail-group + .activity-detail-group {
	margin-top: 13px;
}

.activity-detail-group h2 {
	margin: 0 0 7px;
	color: #66736e;
	font-size: 11px;
	line-height: 1.2;
}

.activity-detail-group dl {
	margin: 0;
	padding: 3px 11px;
	border: 1px solid #e4ebe8;
	border-radius: 11px;
	background: #fff;

	> div {
		min-width: 0;
		padding: 9px 0;

		+ div {
			border-top: 1px solid #edf1ef;
		}
	}
}

.activity-detail-group dt {
	margin-bottom: 5px;
	color: #7a8681;
	font-size: 10px;
	font-weight: 700;
}

.activity-detail-group dd {
	min-width: 0;
	margin: 0;
	color: #26332e;
	font-size: 12px;
	line-height: 1.45;
	overflow-wrap: anywhere;
}

.activity-detail-group code {
	font: 600 10px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
	overflow-wrap: anywhere;
}

.activity-detail-copy {
	display: flex;
	align-items: flex-start;
	gap: 8px;

	code {
		min-width: 0;
		flex: 1 1 auto;
	}

	.address-copy-button {
		flex: 0 0 auto;
		min-width: 32px;
		min-height: 28px;
		padding-inline: 5px;
		font-size: 10px;
	}
}

.activity-detail-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	column-gap: 14px;

	> div:nth-child(2) {
		border-top: 0;
	}
}

.activity-origin-detail {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.activity-detail-message {
	margin: 8px 0 0;
	padding: 9px 10px;
	border-radius: 9px;
	color: #7d4e45;
	background: #fbf1ef;
	font-size: 11px;
	line-height: 1.5;
}

@media (max-width: 389px) {

	.activity-dialog-backdrop {
		padding: 10px;
	}

	.activity-detail-grid {
		grid-template-columns: minmax(0, 1fr);

		> div:nth-child(2) {
			border-top: 1px solid #edf1ef;
		}
	}
}
</style>
