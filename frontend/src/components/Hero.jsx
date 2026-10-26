"use client"
import { useState } from 'react';
import Link from 'next/link';
import HeroVisual from './HeroVisual';
import { useAuth, dashboardFor } from '@/contexts/AuthContext';

export default function HeroComponent() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, loading } = useAuth();

  return (
    <div className='pt-30'>
      

      <section className="relative py-12 overflow-hidden bg-black sm:pb-16 lg:pb-20 xl:pb-24">
        <div className="px-4 mx-auto relative sm:px-6 lg:px-8 max-w-7xl">
          <div className="grid items-center grid-cols-1 gap-y-12 lg:grid-cols-2 gap-x-16">
            <div>
              <h1 className="text-4xl font-normal text-white sm:text-5xl lg:text-6xl xl:text-7xl">
                Privacy-First Decentralized Micro-Lending
              </h1>
              <p className="mt-4 text-lg font-normal text-gray-400 sm:mt-8">
                Access instant loans without sacrificing your privacy. Credloom uses AI-powered credit scoring and blockchain escrow to connect borrowers with lenders in a secure, transparent marketplace.
              </p>

              <div className="mt-8 sm:mt-12">
                <Link 
                  href={user ? dashboardFor(user.role) : "/signup?role=borrower"}
                  className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-black uppercase transition-all duration-200 bg-white rounded-full hover:opacity-90"
                >
                  {loading ? 'Get Started' : user ? 'Open dashboard' : 'Get Started'}
                </Link>
                <Link
                  href="/explorer"
                  className="ml-4 inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white border border-zinc-700 rounded-full hover:bg-zinc-900 transition-colors"
                >
                  See it on-chain
                </Link>
              </div>

            </div>

            <div className="relative">
              <div className="absolute inset-0">
                <svg 
                  className="blur-3xl filter opacity-70" 
                  style={{ filter: 'blur(64px)' }} 
                  width="444" 
                  height="536" 
                  viewBox="0 0 444 536" 
                  fill="none" 
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path 
                    d="M225.919 112.719C343.98 64.6648 389.388 -70.487 437.442 47.574C485.496 165.635 253.266 481.381 135.205 529.435C17.1445 577.488 57.9596 339.654 9.9057 221.593C-38.1482 103.532 107.858 160.773 225.919 112.719Z" 
                    fill="url(#backgroundGradient)" 
                  />
                  <defs>
                    <linearGradient 
                      id="backgroundGradient" 
                      x1="82.7339" 
                      y1="550.792" 
                      x2="-39.945" 
                      y2="118.965" 
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop offset="0%" style={{ stopColor: '#06b6d4' }} />
                      <stop offset="100%" style={{ stopColor: '#a855f7' }} />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <HeroVisual />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}