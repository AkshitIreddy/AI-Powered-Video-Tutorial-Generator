import React from "react";
import Image from "next/image";
import alystria from "../images/Alystria.png";

export default function Nav() {
  return (
    <div className="mt-4 mx-4">
      <nav className={`glass flex items-center justify-between px-8 py-2`}>
        <div className="flex items-center">
          <Image src={alystria} alt="logo" className="h-12 w-12 rounded-xl" />
          <h1 className="gradtext mb-0 pb-0 text-2xl font-bold text-gray-700">
            Alystria AI
          </h1>
        </div>
        <div className="flex items-center text-xl font-bold text-gray-600">
          <a href="#" className="mr-4 pl-2 hover:text-white ">
            AI Generated Video Tutorials
          </a>
          <a
            href="#"
            className="mr-4 border-l-2 pl-2 hover:text-white border-zinc-500"
          >
            Customize Characters & Language
          </a>
          <a
            href="#"
            className="mr-4 border-l-2 pl-2 hover:text-white border-zinc-500"
          >
            Control Tutorial Style
          </a>
        </div>
      </nav>
    </div>
  );
}
