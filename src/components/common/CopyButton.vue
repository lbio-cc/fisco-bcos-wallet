<script lang="ts" setup>
import {useClipboardFeedbackStore} from '@/stores/clipboardFeedback'

defineProps<{
	value: string
	feedbackKey: string
	label: string
}>()

const clipboard = useClipboardFeedbackStore()
</script>

<template>
	<button
		:aria-label="label"
		:class="{
      'copy-success': clipboard.addressCopyStatus[feedbackKey] === 'success',
      'copy-error': clipboard.addressCopyStatus[feedbackKey] === 'error',
    }"
		:title="clipboard.addressCopyLabel(feedbackKey)"
		class="address-copy-button"
		type="button"
		@click="clipboard.copyAddress(value, feedbackKey)"
	>
		<svg
			v-if="!clipboard.addressCopyStatus[feedbackKey]"
			aria-hidden="true"
			viewBox="0 0 20 20"
		>
			<rect height="10" rx="2" width="9" x="7" y="6"></rect>
			<path d="M13 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
		</svg>
		<span v-else>{{ clipboard.addressCopyLabel(feedbackKey) }}</span>
		<span aria-atomic="true" aria-live="polite" class="visually-hidden" role="status">
      {{ clipboard.addressCopyAnnouncement(feedbackKey) }}
    </span>
	</button>
</template>

<style lang="scss" scoped>
.address-copy-button {
	min-width: 32px;
	min-height: 30px;
	flex: 0 0 auto;
	display: inline-grid;
	place-items: center;
	padding: 5px 7px;
	border: 1px solid #cbd9d3;
	border-radius: 7px;
	color: #176b57;
	background: #f3f8f6;
	font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
	font-size: 10px;
	font-weight: 700;
	line-height: 1;
	white-space: nowrap;

	svg {
		width: var(--copy-icon-size, 15px);
		height: var(--copy-icon-size, 15px);
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.6;
	}

	&:hover {
		border-color: #8eb7a8;
		background: #e9f4ef;
	}

	&.copy-success {
		border-color: #9fc6b7;
		color: #176b57;
		background: #e3f2ec;
	}

	&.copy-error {
		border-color: #e2bdb8;
		color: #9d4037;
		background: #faece9;
	}
}

.visually-hidden {
	position: absolute !important;
	width: 1px !important;
	height: 1px !important;
	padding: 0 !important;
	overflow: hidden !important;
	clip: rect(0, 0, 0, 0) !important;
	white-space: nowrap !important;
	border: 0 !important;
}
</style>
