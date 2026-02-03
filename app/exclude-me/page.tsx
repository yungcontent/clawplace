"use client";

import { useEffect, useState } from "react";

export default function ExcludeMe() {
  const [excluded, setExcluded] = useState(false);

  useEffect(() => {
    localStorage.setItem("exclude-analytics", "true");
    setExcluded(true);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">
          {excluded ? "Analytics excluded" : "Setting exclusion..."}
        </h1>
        <p className="text-gray-400">
          {excluded && "You won't be tracked in Vercel Analytics on this device."}
        </p>
      </div>
    </div>
  );
}
