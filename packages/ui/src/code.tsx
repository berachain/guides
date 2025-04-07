import { FC } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export const Code: FC<Props> = ({ children, className }) => (
  <code className={className}>{children}</code>
);
