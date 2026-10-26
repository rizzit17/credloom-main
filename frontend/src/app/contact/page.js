"use client";
import { motion } from "framer-motion";
import ContactForm from "./ContactForm";
import WebcamPixelGrid from "@/components/ui/webcam-pixel-grid";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delay: 0.3,
      duration: 0.8,
      ease: "easeInOut",
      staggerChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: "easeInOut",
    },
  },
};

export default function ContactPage() {
  return (
    <div className="relative w-full min-h-screen overflow-hidden">
      {/* WebcamPixelGrid Background - Fixed position covering entire viewport */}
      <div className="fixed inset-0 z-0">
        <WebcamPixelGrid
          gridCols={64}
          gridRows={48}
          maxElevation={20}
          motionSensitivity={0.35}
          elevationSmoothing={0.12}
          colorMode="monochrome"
          monochromeColor="#ffffff"
          backgroundColor="#000000"
          mirror={true}
          gapRatio={0.08}
          invertColors={false}
          darken={0.7}
          borderColor="#ffffff"
          borderOpacity={0.06}
        />
      </div>

      {/* Dark overlay for better readability */}
      <div className="fixed inset-0 z-10 bg-black/40 backdrop-blur-[1px]" />

      {/* Content Layer */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative z-20 w-full min-h-screen py-32 px-4 flex items-center justify-center antialiased"
      >
        <div className="container mx-auto px-4 md:px-6 max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left Column - Text Content */}
            <div className="space-y-8 pr-0 lg:pr-12 max-w-xl">
              <motion.h1
                variants={itemVariants}
                className="text-5xl lg:text-6xl font-bold tracking-tight text-white leading-tight drop-shadow-2xl"
              >
                Faced any Issues?
              </motion.h1>
              <motion.p
                variants={itemVariants}
                className="text-xl text-gray-200 leading-relaxed font-medium drop-shadow-lg"
              >
                We are available for questions, feedback, or collaboration
                opportunities. Let us know how we can help you achieve your goals!
              </motion.p>
              <motion.div
                variants={itemVariants}
                className="space-y-6 text-gray-200 pt-4"
              >
                {/* Email Contact */}
                <a
                  href="mailto:credloom@gmail.com"
                  className="flex items-center space-x-4 group"
                >
                  <div className="bg-white/15 p-3 rounded-full backdrop-blur-lg transition-all duration-300 group-hover:scale-110 group-hover:bg-white/25 shadow-lg">
                    <svg
                      className="h-6 w-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 4.95a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <span className="text-lg font-medium transition-colors duration-300 group-hover:text-white drop-shadow-md">
                    credloom@gmail.com
                  </span>
                </a>

                {/* Phone Contact */}
                <a href="tel:+919882715895" className="flex items-center space-x-4 group">
                  <div className="bg-white/15 p-3 rounded-full backdrop-blur-lg transition-all duration-300 group-hover:scale-110 group-hover:bg-white/25 shadow-lg">
                    <svg
                      className="h-6 w-6 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                  </div>
                  <span className="text-lg font-medium transition-colors duration-300 group-hover:text-white drop-shadow-md">
                    +91 9882715895
                  </span>
                </a>
              </motion.div>
            </div>
            
            {/* Right Column - Contact Form */}
            <motion.div variants={itemVariants}>
              <ContactForm />
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}