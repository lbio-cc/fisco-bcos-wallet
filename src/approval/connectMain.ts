import {createApp} from 'vue'
import ApprovalPage from './ApprovalPage.vue'
import './approval.scss'

createApp(ApprovalPage, {kind: 'connect'}).mount('#approval-app')
