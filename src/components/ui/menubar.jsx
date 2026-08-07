import * as React from "react";
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar";
import { Menu } from "@base-ui/react/menu";
import { cn } from "../../lib/utils";

const Menubar = React.forwardRef(function Menubar({ className, ...props }, ref) {
  return (
    <MenubarPrimitive ref={ref} className={cn("flex items-center gap-1", className)} {...props} />
  );
});

const MenubarMenu = Menu.Root;

const MenubarTrigger = React.forwardRef(function MenubarTrigger(
  { className, ...props },
  ref,
) {
  return (
    <Menu.Trigger
      ref={ref}
      className={cn(
        "inline-flex min-h-11 items-center rounded-md border border-[#A8ADB5] bg-[#E3E6EB] px-3 text-sm font-semibold text-[#171A1F] transition-colors hover:border-[#00A6D6] hover:bg-[#00A6D6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171A1F] focus-visible:ring-offset-2 focus-visible:ring-offset-[#00B578]",
        className,
      )}
      {...props}
    />
  );
});

const MenubarContent = React.forwardRef(function MenubarContent(
  { className, ...props },
  ref,
) {
  return (
    <Menu.Portal>
      <Menu.Positioner ref={ref} sideOffset={4} className="z-50">
        <Menu.Popup
          className={cn(
            "menu-popup min-w-48 rounded-md border border-[#A8ADB5] bg-[#F5F6F7] p-1 text-[#171A1F] shadow-[0_18px_50px_rgba(23,26,31,0.28)] data-[open]:animate-in data-[closed]:animate-out",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
});

const MenubarItem = React.forwardRef(function MenubarItem(
  { className, ...props },
  ref,
) {
  return (
    <Menu.Item
      ref={ref}
      className={cn(
        "flex min-h-11 w-full cursor-default items-center rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-[#00A6D6] data-[highlighted]:text-[#171A1F] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

const MenubarSeparator = React.forwardRef(function MenubarSeparator(
  { className, ...props },
  ref,
) {
  return <Menu.Separator ref={ref} className={cn("my-1 h-px bg-[#A8ADB5]", className)} {...props} />;
});

export {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
};
