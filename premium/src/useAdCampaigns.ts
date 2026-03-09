import { useState, useEffect } from 'react';

export interface RemoteCampaign {
    id: string;
    type?: string;
    title: string;
    message: string;
    cta_text: string;
    url?: string;
    icon: 'sparkles' | 'alert' | 'info';
}

type LocalAdCampaign = 'promo' | 'profile' | 'jd';
export type AdCampaign = LocalAdCampaign | RemoteCampaign | null;

const REMOTE_CONFIG_URL = 'https://campaign-sand.vercel.app/campaigns.json';

export const useAdCampaigns = (
  isPremium: boolean,
  hasProfile: boolean,
  isAppReady: boolean // True when launcher is visible and steady
) => {
    const [activeAd, setActiveAd] = useState<AdCampaign>(null);

    useEffect(() => {
        // Enforce trigger only when the app reaches an "idle/ready" state (e.g. Launcher is visible)
        // so it doesn't pop up over modals or during meeting.
        // We also check for overlay window explicitly.
        const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
        if (!isAppReady || isOverlayWindow) return;

        let isMounted = true;
        let timer: ReturnType<typeof setTimeout>;

        const checkCampaigns = async () => {
            // 1. Enforce Global Cooldown System
            // We only want to show ONE notification toaster every X hours to avoid annoying the user.
            const lastAdStr = localStorage.getItem('natively_last_ad_shown_time');
            const now = Date.now();
            const cooldownHours = 4; // 4 hours between ANY ad
            
            if (lastAdStr) {
                const lastAdTime = parseInt(lastAdStr, 10);
                const hoursSinceLastAd = (now - lastAdTime) / (1000 * 60 * 60);
                
                // In DEV mode, we skip the cooldown so you can test it easily.
                // In PROD, it stops the script here if the cooldown hasn't passed.
                if (hoursSinceLastAd < cooldownHours && !import.meta.env.DEV) {
                    console.log(`[AdCampaigns] Cooldown active. Last ad was ${hoursSinceLastAd.toFixed(1)}h ago.`);
                    return;
                }
            }

            // 2. Fetch Remote Campaigns (Fast, silent fail)
            let remoteCampaigns: RemoteCampaign[] = [];
            try {
                const controller = new AbortController();
                const fetchTimeout = setTimeout(() => controller.abort(), 3000); // 3s timeout
                
                const res = await fetch(REMOTE_CONFIG_URL, { signal: controller.signal });
                clearTimeout(fetchTimeout);
                
                if (res.ok) {
                    const data = await res.json();
                    
                    // Filter valid campaigns based on targeting
                    remoteCampaigns = (data.active_campaigns || []).filter((c: any) => {
                        // Safe date paring checks
                        if (!c.expires_at || isNaN(Date.parse(c.expires_at))) return false;
                        if (new Date(c.expires_at) < new Date()) return false;
                        
                        // Targeting booleans
                        if (c.targeting?.requires_premium === false && isPremium) return false;
                        if (c.targeting?.requires_premium === true && !isPremium) return false;
                        
                        // Targeting OS parsing - Assuming the native desktop app is current Mac
                        if (c.targeting?.os && c.targeting.os !== 'all' && c.targeting.os !== 'mac') return false; 
                        
                        // Check if user already dismissed this specific remote campaign ID
                        const dismissedIds = JSON.parse(localStorage.getItem('natively_dismissed_campaigns') || '[]');
                        if (dismissedIds.includes(c.id)) return false;

                        return true;
                    });
                }
            } catch (e) {
                console.warn("[AdCampaigns] Remote fetch failed, falling back to local.");
            }

            if (!isMounted) return;

            // 3. Determine what to show
            // Priority: 1. Remote Campaigns, 2. Local Promo, 3. Local JD/Profile Nudges
            let selectedAd: AdCampaign = null;

            if (remoteCampaigns.length > 0) {
                // Pick the highest priority remote ad
                selectedAd = remoteCampaigns.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0))[0];
            } else {
                // 4. Identify Eligible Local Campaigns
                // Helper to check if an ad is eligible (not dismissed recently or at all)
                const isAdEligible = (key: string) => {
                    const val = localStorage.getItem(key);
                    if (!val) return true; // Never dismissed
                    
                    // Legacy support for older users who have 'true' stored
                    if (val === 'true') {
                        return false; 
                    }

                    const dismissedTime = parseInt(val, 10);
                    if (isNaN(dismissedTime)) return true;

                    const daysSinceDismissal = (now - dismissedTime) / (1000 * 60 * 60 * 24);
                    const cooldownDays = import.meta.env.DEV ? 0 : 7; 

                    return daysSinceDismissal >= cooldownDays;
                };

                const eligible: LocalAdCampaign[] = [];
                
                if (!isPremium && isAdEligible('natively_promo_toaster_dismissed')) {
                    eligible.push('promo');
                }
                
                if (!hasProfile && isAdEligible('natively_profile_toaster_dismissed')) {
                    eligible.push('profile');
                }

                // If they have a profile, but no JD uploaded, promote JD awareness
                if (hasProfile && isAdEligible('natively_jd_toaster_dismissed')) {
                    eligible.push('jd');
                }

                if (eligible.length > 0) {
                    const chance = import.meta.env.DEV ? 1 : 0.6; // 100% in DEV, 60% in PROD
                    if (Math.random() <= chance) {
                        selectedAd = eligible[Math.floor(Math.random() * eligible.length)];
                    }
                }
            }

            if (!selectedAd) return;

            // 5. Trigger with a "Natural Delay"
            // 1.5s delay makes it feel like a natural incoming message rather than an immediate blocking popup
            timer = setTimeout(() => {
                if (!isMounted) return;
                setActiveAd(selectedAd);
                localStorage.setItem('natively_last_ad_shown_time', now.toString()); // Start cooldown clock
            }, 1500);
        };

        checkCampaigns();

        return () => {
            isMounted = false;
            if (timer) clearTimeout(timer);
        };

    }, [isAppReady, isPremium, hasProfile]);

    const dismissAd = (campaignId?: string) => {
        if (campaignId) {
            // Track dismissed remote campaigns so they never show again
            const dismissed: string[] = JSON.parse(localStorage.getItem('natively_dismissed_campaigns') || '[]');
            dismissed.push(campaignId);
            localStorage.setItem('natively_dismissed_campaigns', JSON.stringify(dismissed));
            
            // Also enforce local dismissal depending on what was closed if needed
            // The existing tool handled this via specific handlers like natively_promo_toaster_dismissed
        }
        setActiveAd(null);
    };

    // Dev Override Shortcut (Ctrl/Cmd + Shift + A)
    useEffect(() => {
        if (!import.meta.env.DEV) return;
        
        const handleKeyDown = async (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                console.log("[AdCampaigns] Manual trigger activated via shortcut.");
                
                try {
                    const res = await fetch(REMOTE_CONFIG_URL);
                    console.log("[AdCampaigns] fetch status:", res.status);
                    if (res.ok) {
                        const data = await res.json();
                        console.log("[AdCampaigns] fetch data:", data);
                        if (data.active_campaigns && data.active_campaigns.length > 0) {
                            console.log("[AdCampaigns] setting active ad:", data.active_campaigns[0]);
                            setActiveAd(data.active_campaigns[0]);
                        } else {
                            console.log("[AdCampaigns] no active campaigns found in payload");
                        }
                    }
                } catch (err) {
                    console.error("[AdCampaigns] Manual fetch failed", err);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return { activeAd, dismissAd };
};
