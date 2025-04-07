"use client";

import { FC, ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  appName: string;
}

export const Button: FC<Props> = ({ children, className, appName }) => (
  <button
    type="button"
    className={className}
    onClick={() => alert(`Hello from your ${appName} app!`)}
  >
    {children}
  </button>
);
