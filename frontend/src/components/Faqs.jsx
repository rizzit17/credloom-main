'use client'

import Link from "next/link";
import React, { useState } from "react";
import { FaPlus } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";

const Faqs = () => {
  const faqs = [
    {
      id: 1,
      question: "How does Credloom protect my privacy while calculating credit scores?",
      answer:
        "Your credit score comes from wallet behaviour (age, activity, loan history) and your verification tier. There are no documents to upload. Tier 2 and Tier 3 verification (ENS and a proof-of-humanity passport) are recorded as hashes, so your real identity is never stored on-chain.",
    },
    {
      id: 2,
      question: "What happens if I can't repay my loan on time?",
      answer:
        "There is no collateral to seize. After the deadline anyone can settle the default on-chain: if the loan was insured the insurer's reserved stake pays the lender, and your wallet is permanently flagged in the ReputationRegistry contract. Flagged wallets cannot borrow again, and your AI credit score drops sharply.",
    },
    {
      id: 3,
      question: "How are loan interest rates determined?",
      answer:
        "Your AI credit score sets your APR, from 25% at score 0 down to 5% at score 1000, clamped into the band each lender chose. Interest is simple interest computed by the smart contract and fixed when the loan starts. You see the exact amount before you confirm.",
    },
    {
      id: 4,
      question: "What is the role of insurers in Credloom?",
      answer:
        "Insurers stake ETH and publish a premium. When a borrower picks an insurer, the premium is paid upfront and coverage equal to the principal is reserved, so one stake can never promise more than it holds. If the borrower defaults, the reserved stake pays the lender automatically.",
    },
    {
      id: 5,
      question: "Do I need cryptocurrency to use Credloom?",
      answer:
        "Not to borrow. You post no collateral, only your reputation. Each account gets a Credloom-managed wallet, so no browser extension is needed. Support for connecting your own wallet is planned.",
    },
  ];

  const [activeId, setActiveId] = useState(1);

  const toggleAccordion = (id) => {
    setActiveId(activeId === id ? null : id);
  };

  return (
    <section className="relative py-24 bg-black text-white selection:bg-white selection:text-black overflow-hidden">
      {/* Background Decor - Subtle Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1a1a1a_1px,transparent_1px),linear-gradient(to_bottom,#1a1a1a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-20 pointer-events-none" />

      <div className="relative px-6 mx-auto max-w-7xl lg:px-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-20 border-b border-neutral-800 pb-12">
          <div className="max-w-2xl">
            <h2 className="text-4xl font-bold tracking-tighter sm:text-6xl">
              Common <span className="text-neutral-500">Queries</span>
            </h2>
            <p className="mt-6 text-lg text-neutral-400 font-light max-w-lg">
              Understanding decentralized lending, privacy-preserving credit scoring, and blockchain-based escrow. Everything you need to know about Credloom.
            </p>
          </div>
          <div className="hidden md:block">
             <div className="h-px w-24 bg-white mb-4"></div>
             <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">FAQ — 01</p>
          </div>
        </div>

        {/* FAQ List */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Questions Column */}
          <div className="lg:col-span-8">
            <div className="space-y-4">
              {faqs.map((faq) => (
                <div 
                  key={faq.id} 
                  className={`group transition-all duration-300 border-b border-neutral-800 ${activeId === faq.id ? 'pb-4' : ''}`}
                >
                  <button
                    onClick={() => toggleAccordion(faq.id)}
                    className="flex items-start justify-between w-full py-6 text-left focus:outline-none"
                  >
                    <div className="flex items-baseline gap-6 pr-8">
                        <span className="text-sm font-mono text-neutral-600 group-hover:text-white transition-colors duration-300">
                          {faq.id < 10 ? `0${faq.id}` : faq.id}
                        </span>
                        <span className={`text-xl font-medium tracking-tight transition-colors duration-300 ${activeId === faq.id ? 'text-white' : 'text-neutral-300 group-hover:text-white'}`}>
                          {faq.question}
                        </span>
                    </div>
                    
                    <span className="relative flex-shrink-0 flex items-center justify-center w-8 h-8 mt-1">
                      <motion.div
                         animate={{ rotate: activeId === faq.id ? 45 : 0 }}
                         transition={{ duration: 0.3, ease: "anticipate" }}
                      >
                         <FaPlus className={`w-5 h-5 ${activeId === faq.id ? 'text-white' : 'text-neutral-500 group-hover:text-white'}`} />
                      </motion.div>
                    </span>
                  </button>

                  <AnimatePresence>
                    {activeId === faq.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="pl-12 pr-4 md:pr-12 pb-4">
                          <p className="text-base leading-relaxed text-neutral-400 font-light">
                            {faq.answer}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>

          {/* Sticky Sidebar / CTA */}
          <div className="lg:col-span-4 mt-8 lg:mt-0">
            <div className="sticky top-10 p-8 rounded-2xl border border-neutral-800 bg-neutral-900/20 backdrop-blur-sm">
               <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mb-6">
                 <span className="text-2xl">🛡️</span>
               </div>
               <h3 className="text-2xl font-bold text-white mb-2">Still have questions?</h3>
               <p className="text-neutral-400 mb-8 text-sm leading-6">
                 Can&;t find the answer you&;re looking for? Our support team is available to help clarify how Credloom works for your specific needs.
               </p>
               
               <Link 
                  href="/contact" 
                  className="group flex items-center justify-between w-full px-6 py-4 bg-white text-black rounded-lg hover:bg-neutral-200 transition-all duration-300"
               >
                  <span className="font-semibold">Contact Support</span>
                  <span className="group-hover:translate-x-1 transition-transform duration-300">→</span>
               </Link>

               <div className="mt-8 pt-8 border-t border-neutral-800">
                  <p className="text-xs text-neutral-600 uppercase tracking-wider font-mono">
                    Response time
                  </p>
                  <p className="text-white mt-1 font-mono text-sm">
                    &lt; 24 Hours
                  </p>
               </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Faqs;