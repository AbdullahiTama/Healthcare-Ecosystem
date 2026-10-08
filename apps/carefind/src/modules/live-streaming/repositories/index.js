import { createShowRepository } from './showRepository'
import { createSessionRepository } from './sessionRepository'

export { createShowRepository } from './showRepository'
export { createSessionRepository } from './sessionRepository'

export function createLiveStreamingRepositories({ client }) {
  return {
    show: createShowRepository({ client }),
    session: createSessionRepository({ client }),
  }
}
