import { getPayload } from 'payload'
import config from '@/payload.config'

/** Cached Payload Local API client for frontend server components. */
export const getClient = async () => getPayload({ config: await config })

export const SERVER_URL = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'https://cms.projectsites.dev'
