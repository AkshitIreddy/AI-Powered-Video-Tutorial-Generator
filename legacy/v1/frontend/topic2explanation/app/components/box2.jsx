import React from "react";
import { useState } from "react";

export default function Box2(props) {
  const toggleMenu = () => setIsOpen(!isOpen);
  const toggleMenu1 = () => setIsOpen1(!isOpen1);
  const [isOpen, setIsOpen] = useState(false);
  const [isOpen1, setIsOpen1] = useState(false);
  return (
    <div>
      <div className="ml-4 mt-2 mb-3 text-3xl text-gray-600 border-b-2 border-gray-500">
        Parameters🛠️
      </div>
      <div className="ml-4 mt-3 space-y-1 text-xl">
        <p>Level🎓</p>
        <div className="inline-flex items-stretch rounded-md border bg-white">
          <a className="rounded-l-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-700">
            {props.level}
          </a>
          <div className="relative">
            <button
              type="button"
              className="inline-flex h-full items-center justify-center rounded-r-md border-l border-gray-100 px-2 text-gray-600 hover:bg-gray-50 hover:text-gray-700"
              onClick={toggleMenu}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {isOpen && (
              <div className="absolute right-0 z-10 mt-4 w-56 origin-top-right rounded-md border border-gray-100 bg-white shadow-lg">
                <div className="p-2">
                  <a
                    onClick={() => {
                      props.setLevel("beginner");
                      setIsOpen(false);
                    }}
                    className="block rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  >
                    Beginner
                  </a>

                  <a
                    onClick={() => {
                      props.setLevel("intermediate");
                      setIsOpen(false);
                    }}
                    className="block rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  >
                    Intermediate
                  </a>

                  <a
                    onClick={() => {
                      props.setLevel("advanced");
                      setIsOpen(false);
                    }}
                    className="block rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  >
                    Advanced
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="ml-4 mt-3 space-y-1 text-xl">
        <p>Character🎭</p>
        <div className="inline-flex items-stretch rounded-md border bg-white">
          <a className="rounded-l-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-700">
            {props.characterName}
          </a>
          <div className="relative">
            <button
              type="button"
              className="inline-flex h-full items-center justify-center rounded-r-md border-l border-gray-100 px-2 text-gray-600 hover:bg-gray-50 hover:text-gray-700"
              onClick={toggleMenu1}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {isOpen1 && (
              <div className="absolute right-0 z-10 mt-4 w-56 origin-top-right rounded-md border border-gray-100 bg-white shadow-lg">
                <div className="p-2">
                  <a
                    onClick={() => {
                      props.setCharacterName("Benjamin");
                      setIsOpen1(false);
                    }}
                    className="block rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  >
                    Benjamin
                  </a>
                  <a
                    onClick={() => {
                      props.setCharacterName("Sophia");
                      setIsOpen1(false);
                    }}
                    className="block rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                  >
                    Sophia
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mx-4 mt-3">
        <div className="flex">
          <p className="mr-auto text-xl">Creativity✨</p>
          <p>{props.creative}</p>
        </div>
        <input
          id="default-range"
          type="range"
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-300  "
          min="1"
          max="10"
          value={props.creative}
          onChange={(e) => props.setCreative(e.target.value)}
        />
      </div>
      <div className="mx-4 mt-3">
        <div className="flex">
          <p className="mr-auto text-xl">Humour🤣</p>
          <p>{props.humour}</p>
        </div>
        <input
          id="default-range"
          type="range"
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-300  "
          min="1"
          max="10"
          value={props.humour}
          onChange={(e) => props.setHumour(e.target.value)}
        />
      </div>
      <div className="mx-4 mt-3">
        <div className="flex">
          <p className="mr-auto text-xl">Age🐤</p>
          <p>{props.age}</p>
        </div>
        <input
          id="default-range"
          type="range"
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-300  "
          min="1"
          max="100"
          value={props.age}
          onChange={(e) => props.setAge(e.target.value)}
        />
      </div>
    </div>
  );
}
