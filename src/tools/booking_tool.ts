import { registry } from '../tool_registry';

/**
 * Represents the structure of the booking tool arguments.
 */
interface BookingArgs {
  date: string;
  time: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  specialRequests?: string;
}

/**
 * Implementation of the Booking Tool.
 * This tool simulates the process of reserving a table in a restaurant.
 */
export const bookingTool = {
  name: 'create_booking',
  description: 'Creates a restaurant booking for a specific date, time, and party size.',
  execute: async (args: any): Promise<string> => {
    const { date, time, partySize, name, email, phone, specialRequests } = args as BookingArgs;

    // Validation
    if (!date || !time || !partySize || !name || !email || !phone) {
      return `Error: Missing required booking details. Please provide date, time, party size, name, email, and phone.`;
    }

    console.log(`[Tool: create_booking] Processing reservation for ${name} (${partySize} guests) on ${date} at ${time}`);

    // Simulate database/API latency
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Simulate a successful booking
    return `Success: Reservation confirmed for ${name} on ${date} at ${time}. Booking ID: RES-${Math.floor(Math.random() * 10000)}`;
  }
};

// Register the tool with the central registry upon module load
registry.register_tool(bookingTool);
