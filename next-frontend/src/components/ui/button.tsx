import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// shadcn/ui base-nova button, adapted: explicit transition properties instead of
// `transition-all`, the global focus outline instead of `outline-none` plus a translucent ring,
// and taller sizes so primary actions meet comfortable touch targets.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color] duration-150 select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[#2249a3] active:bg-[#1d3f8d]",
        outline: "border-input bg-surface text-foreground hover:bg-muted active:bg-[#e2ddd3]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[#e2ddd3]",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-white hover:bg-[#991f19]",
        link: "text-primary underline underline-offset-4 decoration-1 hover:decoration-2",
        rail: "border-rail-line bg-transparent text-rail-foreground hover:bg-rail-active hover:border-rail-muted",
      },
      size: {
        default: "h-9 gap-1.5 px-3",
        sm: "h-8 gap-1 px-2.5 text-[0.8125rem]",
        lg: "h-11 gap-2 px-4 text-[0.9375rem]",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
