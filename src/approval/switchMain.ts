import {createApp} from 'vue'
import ApprovalPage from './ApprovalPage.vue'
import './approval.scss'

createApp(ApprovalPage, {kind: 'switch'}).mount('#approval-app')
