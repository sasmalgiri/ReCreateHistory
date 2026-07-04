//
// privacyGate.ts — privacy is enforced, not promised. Filters cloud providers
// out of capability resolution unless the user has explicitly enabled cloud
// routing. Ported from PrivacyGate.swift. There is NO network call outside
// the providers, and cloud providers never resolve while this gate is closed.
//

import type { PrivacyLevel } from '../../shared/ai'

const RANK: Record<PrivacyLevel, number> = { onDevice: 0, localNetwork: 1, cloud: 2 }

export class PrivacyGate {
  constructor(public allowCloud: boolean) {}

  /**
   * A provider manifest is eligible for a spec when it is at least as private
   * as the spec demands. Cloud providers are additionally gated by allowCloud.
   */
  isEligible(manifestPrivacy: PrivacyLevel, specPrivacy: PrivacyLevel): boolean {
    if (manifestPrivacy === 'cloud' && !this.allowCloud) return false
    return RANK[manifestPrivacy] <= RANK[specPrivacy]
  }
}
