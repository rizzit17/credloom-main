import Link from "next/link";
import { Shield } from "lucide-react";
import { BsLinkedin, BsTelegram, BsTwitter } from "react-icons/bs";

function Footer() {
  const navLinks = [
    { label: "Home", href: "/" },
    { label: "Explorer", href: "/explorer" },
    { label: "Analytics", href: "/analytics" },
    { label: "Contact Us", href: "/contact" },
    { label: "Project documentation", href: "/project" },
  ];
  const socialIcons = [
    { icon: <BsTwitter className="w-5 h-5" />, href: "https://twitter.com/credloom" },
    { icon: <BsTelegram className="w-5 h-5" />, href: "https://t.me/credloom" },
    { icon: <BsLinkedin className="w-5 h-5" />, href: "https://linkedin.com/company/credloom" },
  ];

  return (
    <footer className="relative bg-black border-t border-zinc-800 text-white overflow-hidden">
      {/* Gradient Overlays */}
      <div className="absolute top-0 left-0 w-72 h-72 bg-zinc-700/5 blur-3xl rounded-full -translate-x-1/3 -translate-y-1/3"></div>
      <div className="absolute bottom-0 right-0 w-72 h-72 bg-zinc-700/5 blur-3xl rounded-full translate-x-1/3 translate-y-1/3"></div>

      {/* Content */}
      <div className="relative z-10 max-w-[1300px] mx-auto px-6">
        <div className="py-16 md:py-24">
          <div className="flex flex-col md:flex-row justify-between gap-14">
            {/* Left Section */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-black" />
                </div>
                <span className="text-xl font-bold">Credloom</span>
              </div>
              <p className="text-zinc-400 text-sm sm:text-base max-w-sm leading-relaxed">
                Privacy-first decentralized micro-lending marketplace powered by{" "}
                <span className="text-white font-medium">AI credit scoring</span> and blockchain escrow.
              </p>

              <div className="flex flex-wrap gap-6 pt-10">
                {navLinks.map((link, i) => (
                  <Link key={i} href={link.href}>
                    <span className="text-sm sm:text-base text-zinc-400 hover:text-white transition-colors cursor-pointer">
                      {link.label}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {/* Right Section */}
            <div>
              <p className="text-lg font-semibold mb-3">Contact Us</p>
              <Link
                href="mailto:credloom@gmail.com"
                className="text-zinc-400 hover:text-white text-sm sm:text-base transition-colors"
              >
                credloom@gmail.com
              </Link>

              <div className="flex flex-row items-center gap-4 pt-8">
                <p className="text-sm sm:text-base text-zinc-500">Follow us:</p>
                <div className="flex gap-3">
                  {socialIcons.map((item, idx) => (
                    <Link
                      key={idx}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-10 h-10 flex items-center justify-center rounded-full border border-zinc-800 bg-white/5 backdrop-blur-sm hover:bg-white hover:border-white hover:text-black text-zinc-400 transition-all duration-300"
                    >
                      {item.icon}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="relative z-10 border-t border-zinc-800 py-6 text-center text-xs text-zinc-600">
        © {new Date().getFullYear()}{" "}
        <span className="text-white font-medium">Credloom</span>. All rights
        reserved.
      </div>
    </footer>
  );
}

export default Footer;
