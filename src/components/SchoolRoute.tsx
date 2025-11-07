import { ReactNode } from "react";
import { SchoolProvider } from "@/contexts/SchoolContext";
import { Layout } from "./Layout";

interface SchoolRouteProps {
  children: ReactNode;
}

export const SchoolRoute = ({ children }: SchoolRouteProps) => {
  return (
    <SchoolProvider>
      <Layout>{children}</Layout>
    </SchoolProvider>
  );
};
