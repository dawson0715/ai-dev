import {serviceAccountNames} from '../services/gitlabAuth.js'

export function gitlabController() {
    return {
        listServiceAccounts() {
            return {service_accounts: serviceAccountNames()}
        }
    }
}
