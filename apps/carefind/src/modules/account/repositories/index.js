import { createProfileRepository } from './profileRepository'

export { createProfileRepository } from './profileRepository'

export function createAccountRepositories({ client }) {
  return {
    profile: createProfileRepository({ client }),
  }
}
