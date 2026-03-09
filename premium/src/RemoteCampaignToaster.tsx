import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Sparkles, Info } from 'lucide-react';
import { cn } from '../../src/lib/utils';
import { RemoteCampaign } from './useAdCampaigns';

// If running in electron, we might have window.electronAPI

interface RemoteCampaignToasterProps {
    className?: string;
    isOpen: boolean;
    campaign: RemoteCampaign;
    onDismiss: () => void;
}

export const RemoteCampaignToaster: React.FC<RemoteCampaignToasterProps> = ({ 
    className, 
    isOpen, 
    campaign, 
    onDismiss 
}) => {

    // Dev override shortcut logic to dismiss
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!import.meta.env.DEV) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                if (isOpen) onDismiss();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onDismiss]);

    const handlePrimaryAction = async () => {
        if (campaign.url && window.electronAPI && window.electronAPI.openExternal) {
            try {
                await window.electronAPI.openExternal(campaign.url);
            } catch (err) {
                console.error("Failed to open external url:", err);
            }
        } else if (campaign.url) {
            // Fallback for web mode testing if external API is missing
            window.open(campaign.url, '_blank');
        }
        
        onDismiss();
    };

    const renderIcon = () => {
        const iconSize = 24;
        const iconClass = "text-white relative z-10 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]";
        
        switch (campaign.icon) {
            case 'alert':
                return <AlertCircle size={iconSize} className={iconClass} fill="white" />;
            case 'sparkles':
                return <Sparkles size={iconSize} className={iconClass} fill="white" />;
            case 'info':
            default:
                return <Info size={iconSize} className={iconClass} fill="white" />;
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.94, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: [0.32, 0, 0.67, 0] } }}
                        transition={{ type: "spring", stiffness: 450, damping: 35 }}
                        className={cn(
                            "relative w-[480px] overflow-hidden",
                            "rounded-[24px]",
                            "bg-[#0B0F14]",
                            "border border-white/[0.08]",
                            "shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8),0_8px_32px_-8px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]",
                            "flex flex-col items-center pb-[24px]",
                            className
                        )}
                    >
                        {/* Background Structure */}
                        <div className="absolute inset-0 bg-[#121826]" />
                        <div className="absolute top-0 left-0 right-0 h-[300px] bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
                        
                        {/* Top Sparkle Border */}
                        <div className="absolute top-0 left-[20%] right-[20%] h-px bg-gradient-to-r from-transparent via-white/[0.15] to-transparent" />
                        
                        {/* Content Container */}
                        <div className="relative z-10 w-full flex flex-col items-center pt-[48px]">
                            
                            {/* Prism Visual */}
                            <div className="relative w-[64px] h-[64px] mb-[32px]">
                                <motion.div 
                                    animate={{ 
                                        rotate: [0, 10, 0, -10, 0],
                                        scale: [1, 1.05, 1]
                                    }}
                                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                                    className="absolute inset-0 flex items-center justify-center"
                                >
                                    {/* Layered Glass Triangles for a 'Prism' effect */}
                                    <div className="absolute w-full h-full border border-white/20 rotate-45 rounded-[12px] backdrop-blur-sm bg-white/[0.02]" />
                                    <div className="absolute w-[80%] h-[80%] border border-white/10 -rotate-12 rounded-[8px]" />
                                    {renderIcon()}
                                </motion.div>
                                {/* Glow */}
                                <div className="absolute inset-0 bg-white/5 blur-[20px] rounded-full scale-150" />
                            </div>

                            {/* Typography */}
                            <div className="text-center px-[40px] mb-[40px]">
                                <h3 className="text-[32px] font-[700] leading-[1.1] text-white tracking-[-0.04em] mb-[12px] antialiased">
                                    {campaign.title}
                                </h3>
                                <p className="text-[15px] leading-[1.6] text-white/50 mx-auto font-medium antialiased">
                                    {campaign.message}
                                </p>
                            </div>

                            {/* Promotional "Urgency" Block */}
                            {campaign.type === 'promo' && (
                                <motion.div 
                                    animate={{ y: [0, -4, 0] }} 
                                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                                    className="w-[380px] rounded-[20px] bg-gradient-to-b from-[#4DA3FF]/[0.08] to-transparent border border-[#4DA3FF]/[0.15] p-[24px] mb-[40px] relative overflow-hidden group shadow-[0_8px_32px_-8px_rgba(77,163,255,0.15)]"
                                >
                                    <div className="absolute top-0 right-[-10px] p-4 opacity-[0.05] group-hover:opacity-10 transition-opacity">
                                        <Sparkles size={80} className="text-[#4DA3FF]" />
                                    </div>
                                    
                                    <div className="flex items-center justify-between mb-3 relative z-10">
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#4DA3FF]/80">Early Adopter Bonus</span>
                                            <span className="text-[14px] font-[900] tracking-widest text-white/90 font-mono mt-0.5 animate-pulse">EARLYADOPTER</span>
                                        </div>
                                        <div className="px-2.5 py-1 rounded-full bg-[#4DA3FF] text-black text-[10px] font-black tracking-tighter shadow-[0_0_12px_rgba(77,163,255,0.5)] animate-pulse">
                                            ONLY 50 LEFT
                                        </div>
                                    </div>

                                    <div className="flex items-end gap-3 leading-none relative z-10 mt-5">
                                        <div className="flex items-baseline gap-1.5">
                                            <span className="text-[48px] font-[700] text-white leading-none tracking-[-0.02em] text-shadow-sm">$5</span>
                                            <span className="text-[14px] font-bold text-[#4DA3FF]/80 mb-1.5">50% OFF</span>
                                        </div>
                                        <div className="h-[24px] w-px bg-white/10 mx-1 mb-2" />
                                        <div className="mb-2">
                                            <span className="text-[13px] font-semibold text-white/80 block leading-tight">Lifetime Access</span>
                                            <span className="text-[11px] font-medium text-white/40 line-through tracking-wide">Regularly $10.00</span>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {/* Actions & Social Proof */}
                            <div className="w-full px-[48px] flex flex-col gap-4 relative">
                                
                                {/* Pulse Glow behind button */}
                                <div className="absolute left-[48px] right-[48px] h-[54px] bg-[#4DA3FF]/40 blur-xl rounded-[18px] animate-[pulse_4s_ease-in-out_infinite] scale-105" />

                                <button
                                    onClick={handlePrimaryAction}
                                    className="relative w-full h-[54px] rounded-[18px] bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white font-semibold text-[17px] tracking-wide transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_20px_40px_-12px_rgba(59,130,246,0.4)] overflow-hidden group/btn"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:animate-[shimmer_1.5s_infinite]" />
                                    <style>{`
                                        @keyframes shimmer {
                                            100% { transform: translateX(100%); }
                                        }
                                    `}</style>
                                    <span className="relative z-10 tracking-wide drop-shadow-sm">{campaign.cta_text}</span>
                                </button>

                                {/* Social Proof & Dismiss */}
                                <div className="flex flex-col items-center gap-3 mt-1">
                                    <div className="flex items-center gap-1.5 text-white/40">
                                        <span className="text-[12px] font-medium">3000+ people are already using Natively</span>
                                    </div>
                                    <button
                                        onClick={onDismiss}
                                        className="text-[12px] text-white/20 font-bold hover:text-white/40 transition-colors duration-200 uppercase tracking-[0.15em] mt-1"
                                    >
                                        Maybe later
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
